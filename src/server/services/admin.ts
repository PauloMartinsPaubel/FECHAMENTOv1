import bcrypt from "bcryptjs";
import { Prisma, type PaymentKind } from "@/generated/prisma/client";
import { formatBRL, MAX_CENTS } from "@/lib/finance";
import type { RoleCode } from "@/lib/permissions";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { BCRYPT_COST } from "../seed";
import { validatePasswordStrength } from "./auth";
import { parseRecipients } from "./email";

// ---------------------------------------------------------------------------
// Usuários
// ---------------------------------------------------------------------------

const NAME_MAX = 100;
function cleanName(value: string, label = "O nome"): string {
  const v = value.trim();
  if (v.length < 2) throw new ServiceError(`${label} precisa ter ao menos 2 letras.`);
  if (v.length > NAME_MAX) throw new ServiceError(`${label} é longo demais.`);
  return v;
}

export async function listUsers(actor: Actor) {
  assertCan(actor, "users.manage");
  return prisma.user.findMany({
    where: { restaurantId: actor.restaurantId },
    include: { role: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });
}

export async function createUser(actor: Actor, input: { name: string; email: string; role: RoleCode; password: string }) {
  assertCan(actor, "users.manage");
  const name = cleanName(input.name);
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ServiceError("E-mail inválido.");
  const weak = validatePasswordStrength(input.password);
  if (weak) throw new ServiceError(weak);
  const role = await prisma.role.findUnique({ where: { code: input.role } });
  if (!role) throw new ServiceError("Papel inválido.");
  if (await prisma.user.findUnique({ where: { email } })) throw new ServiceError("Já existe um usuário com este e-mail.", "CONFLICT");

  const hash = await bcrypt.hash(input.password, BCRYPT_COST);
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { restaurantId: actor.restaurantId, roleId: role.id, name, email, passwordHash: hash, mustChangePassword: true },
    });
    await audit(tx, actor, { action: "user.create", entity: "user", entityId: user.id, newValue: { name, email, role: input.role } });
    return user;
  });
}

export async function updateUser(actor: Actor, userId: string, input: { name?: string; role?: RoleCode; active?: boolean }) {
  assertCan(actor, "users.manage");
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, restaurantId: actor.restaurantId }, include: { role: true } });
    if (!user) throw new ServiceError("Usuário não encontrado.", "NOT_FOUND");

    const nextRole = input.role ?? (user.role.code as RoleCode);
    const nextActive = input.active ?? user.active;
    if (userId === actor.userId && (!nextActive || nextRole !== "ADMIN")) {
      throw new ServiceError("Você não pode desativar nem rebaixar o próprio acesso.", "FORBIDDEN");
    }
    if (user.role.code === "ADMIN" && (nextRole !== "ADMIN" || !nextActive)) {
      const others = await tx.user.count({ where: { restaurantId: actor.restaurantId, active: true, role: { code: "ADMIN" }, id: { not: userId } } });
      if (others === 0) throw new ServiceError("Precisa existir ao menos um administrador ativo.", "STATE");
    }
    const role = input.role ? await tx.role.findUnique({ where: { code: input.role } }) : null;
    const updated = await tx.user.update({
      where: { id: userId },
      data: {
        ...(input.name !== undefined ? { name: cleanName(input.name) } : {}),
        ...(role ? { roleId: role.id } : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
    if (input.active === false) await tx.authSession.deleteMany({ where: { userId } });
    await audit(tx, actor, {
      action: "user.update",
      entity: "user",
      entityId: userId,
      oldValue: { name: user.name, role: user.role.code, active: user.active },
      newValue: { name: updated.name, role: nextRole, active: updated.active },
    });
    return updated;
  });
}

export async function resetUserPassword(actor: Actor, userId: string, newPassword: string) {
  assertCan(actor, "users.manage");
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new ServiceError(weak);
  const hash = await bcrypt.hash(newPassword, BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    const user = await tx.user.findFirst({ where: { id: userId, restaurantId: actor.restaurantId } });
    if (!user) throw new ServiceError("Usuário não encontrado.", "NOT_FOUND");
    await tx.user.update({ where: { id: userId }, data: { passwordHash: hash, mustChangePassword: true, failedLogins: 0, lockedUntil: null } });
    await tx.authSession.deleteMany({ where: { userId } });
    await audit(tx, actor, { action: "user.password_reset", entity: "user", entityId: userId });
  });
}

// ---------------------------------------------------------------------------
// Cadastros: canais, formas de pagamento, bandeiras, caixas, turnos
// ---------------------------------------------------------------------------

function uniqueViolation(err: unknown, message: string): never {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") throw new ServiceError(message, "CONFLICT");
  throw err;
}

export async function saveChannel(actor: Actor, input: { id?: string; name: string; isPlatform: boolean; active: boolean; sortOrder?: number }) {
  assertCan(actor, "catalog.manage");
  const name = cleanName(input.name, "O nome do canal");
  try {
    return await prisma.$transaction(async (tx) => {
      const before = input.id ? await tx.salesChannel.findFirst({ where: { id: input.id, restaurantId: actor.restaurantId } }) : null;
      if (input.id && !before) throw new ServiceError("Canal não encontrado.", "NOT_FOUND");
      const data = { name, isPlatform: input.isPlatform, active: input.active, sortOrder: input.sortOrder ?? before?.sortOrder ?? 99 };
      const saved = before
        ? await tx.salesChannel.update({ where: { id: before.id }, data })
        : await tx.salesChannel.create({ data: { ...data, restaurantId: actor.restaurantId } });
      await audit(tx, actor, { action: before ? "catalog.channel.update" : "catalog.channel.create", entity: "sales_channel", entityId: saved.id, oldValue: before, newValue: saved });
      return saved;
    });
  } catch (e) {
    return uniqueViolation(e, "Já existe um canal com este nome.");
  }
}

export async function savePaymentMethod(actor: Actor, input: { id?: string; name: string; kind?: PaymentKind; active: boolean; sortOrder?: number }) {
  assertCan(actor, "catalog.manage");
  const name = cleanName(input.name, "O nome da forma de pagamento");
  try {
    return await prisma.$transaction(async (tx) => {
      const before = input.id ? await tx.paymentMethod.findFirst({ where: { id: input.id, restaurantId: actor.restaurantId } }) : null;
      if (input.id && !before) throw new ServiceError("Forma de pagamento não encontrada.", "NOT_FOUND");
      if (before) {
        if (input.kind && input.kind !== before.kind) {
          throw new ServiceError("O tipo de uma forma de pagamento não pode mudar depois de criada. Crie outra e desative esta.");
        }
        if (before.kind === "CASH" && !input.active) throw new ServiceError("A forma Dinheiro não pode ser desativada: o fundo e o dinheiro contado dependem dela.");
      } else if (!input.kind) {
        throw new ServiceError("Escolha o tipo da forma de pagamento.");
      } else if (input.kind === "CASH") {
        throw new ServiceError("Já existe a forma Dinheiro. O sistema trabalha com uma gaveta só.");
      }
      const saved = before
        ? await tx.paymentMethod.update({ where: { id: before.id }, data: { name, active: input.active, sortOrder: input.sortOrder ?? before.sortOrder } })
        : await tx.paymentMethod.create({ data: { restaurantId: actor.restaurantId, name, kind: input.kind!, active: input.active, sortOrder: input.sortOrder ?? 99 } });
      await audit(tx, actor, { action: before ? "catalog.payment_method.update" : "catalog.payment_method.create", entity: "payment_method", entityId: saved.id, oldValue: before, newValue: saved });
      return saved;
    });
  } catch (e) {
    return uniqueViolation(e, "Já existe uma forma de pagamento com este nome.");
  }
}

export async function saveTicketBrand(actor: Actor, input: { id?: string; name: string; active: boolean; sortOrder?: number }) {
  assertCan(actor, "catalog.manage");
  const name = cleanName(input.name, "O nome da bandeira");
  try {
    return await prisma.$transaction(async (tx) => {
      const before = input.id ? await tx.ticketBrand.findFirst({ where: { id: input.id, restaurantId: actor.restaurantId } }) : null;
      if (input.id && !before) throw new ServiceError("Bandeira não encontrada.", "NOT_FOUND");
      const data = { name, active: input.active, sortOrder: input.sortOrder ?? before?.sortOrder ?? 99 };
      const saved = before
        ? await tx.ticketBrand.update({ where: { id: before.id }, data })
        : await tx.ticketBrand.create({ data: { ...data, restaurantId: actor.restaurantId } });
      await audit(tx, actor, { action: before ? "catalog.ticket_brand.update" : "catalog.ticket_brand.create", entity: "ticket_brand", entityId: saved.id, oldValue: before, newValue: saved });
      return saved;
    });
  } catch (e) {
    return uniqueViolation(e, "Já existe uma bandeira com este nome.");
  }
}

export async function saveRegister(actor: Actor, input: { id?: string; name: string; active: boolean }) {
  assertCan(actor, "catalog.manage");
  const name = cleanName(input.name, "O nome do caixa");
  try {
    return await prisma.$transaction(async (tx) => {
      const before = input.id ? await tx.cashRegister.findFirst({ where: { id: input.id, restaurantId: actor.restaurantId } }) : null;
      if (input.id && !before) throw new ServiceError("Caixa não encontrado.", "NOT_FOUND");
      if (before && !input.active) {
        const open = await tx.cashSession.count({ where: { registerId: before.id, status: { in: ["OPEN", "REOPENED"] } } });
        if (open > 0) throw new ServiceError("Este caixa tem sessão aberta. Feche antes de desativar.", "STATE");
      }
      const saved = before
        ? await tx.cashRegister.update({ where: { id: before.id }, data: { name, active: input.active } })
        : await tx.cashRegister.create({ data: { restaurantId: actor.restaurantId, name, active: input.active, sortOrder: 99 } });
      await audit(tx, actor, { action: before ? "catalog.register.update" : "catalog.register.create", entity: "cash_register", entityId: saved.id, oldValue: before, newValue: saved });
      return saved;
    });
  } catch (e) {
    return uniqueViolation(e, "Já existe um caixa com este nome.");
  }
}

export async function saveShift(actor: Actor, input: { id: string; name: string; startTime: string; endTime: string; active: boolean }) {
  assertCan(actor, "catalog.manage");
  const name = cleanName(input.name, "O nome do turno");
  const time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(input.startTime) || !time.test(input.endTime)) throw new ServiceError("Horário inválido (use HH:MM).");
  return prisma.$transaction(async (tx) => {
    const before = await tx.shift.findFirst({ where: { id: input.id, restaurantId: actor.restaurantId } });
    if (!before) throw new ServiceError("Turno não encontrado.", "NOT_FOUND");
    if (!input.active && (await tx.cashSession.count({ where: { shiftId: before.id, status: { in: ["OPEN", "REOPENED"] } } })) > 0) {
      throw new ServiceError("Este turno tem caixa aberto. Feche antes de desativar.", "STATE");
    }
    const saved = await tx.shift.update({ where: { id: before.id }, data: { name, startTime: input.startTime, endTime: input.endTime, active: input.active } });
    await audit(tx, actor, { action: "catalog.shift.update", entity: "shift", entityId: saved.id, oldValue: before, newValue: saved });
    return saved;
  });
}

// ---------------------------------------------------------------------------
// Configurações
// ---------------------------------------------------------------------------

export async function saveSettings(
  actor: Actor,
  input: {
    defaultOpeningFloatCents: number;
    toleranceCents: number;
    defaultFloatMode: "NEW_OPENING" | "TRANSFER";
    closingRecipients: string;
    emailFrom?: string | null;
    restaurantName?: string;
    /** undefined = não mexe (telas antigas); "" = alerta desligado */
    alertRecipients?: string;
    /** null = usa a tolerância */
    alertThresholdCents?: number | null;
  },
) {
  assertCan(actor, "settings.manage");
  for (const [v, label] of [[input.defaultOpeningFloatCents, "fundo padrão"], [input.toleranceCents, "tolerância"]] as const) {
    if (!Number.isInteger(v) || v < 0 || v > MAX_CENTS) throw new ServiceError(`Valor inválido em ${label}.`);
  }
  const recipients = parseRecipients(input.closingRecipients);
  const alertRecipients = input.alertRecipients === undefined ? undefined : parseRecipients(input.alertRecipients);
  if (input.alertThresholdCents != null && (!Number.isInteger(input.alertThresholdCents) || input.alertThresholdCents < 0 || input.alertThresholdCents > MAX_CENTS)) {
    throw new ServiceError("Valor inválido no limite do alerta.");
  }
  const emailFrom = input.emailFrom?.trim() || null;
  if (emailFrom && emailFrom.length > 200) throw new ServiceError("Remetente longo demais.");
  return prisma.$transaction(async (tx) => {
    const before = await tx.setting.findUnique({ where: { restaurantId: actor.restaurantId } });
    const data = {
      defaultOpeningFloatCents: input.defaultOpeningFloatCents,
      toleranceCents: input.toleranceCents,
      defaultFloatMode: input.defaultFloatMode,
      closingRecipients: recipients,
      emailFrom,
      ...(alertRecipients !== undefined ? { alertRecipients } : {}),
      ...(input.alertThresholdCents !== undefined ? { alertThresholdCents: input.alertThresholdCents } : {}),
    };
    const saved = await tx.setting.upsert({ where: { restaurantId: actor.restaurantId }, update: data, create: { ...data, restaurantId: actor.restaurantId } });
    if (input.restaurantName?.trim()) {
      await tx.restaurant.update({ where: { id: actor.restaurantId }, data: { name: cleanName(input.restaurantName, "O nome do restaurante") } });
    }
    await audit(tx, actor, {
      action: "settings.update",
      entity: "settings",
      entityId: saved.id,
      oldValue: before && { ...before, defaultOpeningFloat: formatBRL(before.defaultOpeningFloatCents), tolerance: formatBRL(before.toleranceCents) },
      newValue: { ...saved, defaultOpeningFloat: formatBRL(saved.defaultOpeningFloatCents), tolerance: formatBRL(saved.toleranceCents) },
    });
    return saved;
  });
}
