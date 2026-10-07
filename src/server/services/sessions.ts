import { assertCanOpenCash } from "./billing";
import { Prisma } from "@/generated/prisma/client";
import { addDays, fromDbDate, isIsoDate, todayIso, toDbDate } from "@/lib/dates";
import { formatBRL, MAX_CENTS } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { Actor, assertCan } from "../actor";
import { audit, recordAdjustment } from "../audit";
import { Db, prisma } from "../db";
import { ServiceError } from "../errors";

type SessionAccessFields = { restaurantId: string; status: string; responsibleId: string; closedById: string | null };

/**
 * Gerente e administrador veem qualquer caixa do restaurante.
 * Operador vê caixas abertos/reabertos e os que ele mesmo abriu ou fechou.
 */
export function canAccessSession(actor: Actor, s: SessionAccessFields): boolean {
  if (s.restaurantId !== actor.restaurantId) return false;
  if (can(actor.role, "reports.view")) return true;
  if (s.status === "OPEN" || s.status === "REOPENED") return true;
  return s.responsibleId === actor.userId || s.closedById === actor.userId;
}

export function assertSessionAccess(actor: Actor, s: SessionAccessFields): void {
  if (!canAccessSession(actor, s)) throw new ServiceError("Você não tem acesso a este caixa.", "FORBIDDEN");
}

export type EditMode = "normal" | "correction";

/**
 * Caixa aberto: quem pode lançar edita. Caixa reaberto: só quem pode corrigir fechamentos,
 * e cada alteração exige motivo. Caixa fechado: ninguém edita, só reabrindo antes.
 */
export function assertEditable(actor: Actor, s: SessionAccessFields): EditMode {
  assertSessionAccess(actor, s);
  if (s.status === "OPEN") {
    assertCan(actor, "movement.write");
    return "normal";
  }
  if (s.status === "REOPENED") {
    assertCan(actor, "closing.correct");
    return "correction";
  }
  throw new ServiceError("Este caixa está fechado. Um gerente precisa reabri-lo, com motivo, para corrigir.", "STATE");
}

/** Modo de edição que o usuário tem neste caixa agora (null = só leitura). Usado para montar a tela. */
export function editModeFor(actor: Actor, s: SessionAccessFields): EditMode | null {
  if (!canAccessSession(actor, s)) return null;
  if (s.status === "OPEN" && can(actor.role, "movement.write")) return "normal";
  if (s.status === "REOPENED" && can(actor.role, "closing.correct")) return "correction";
  return null;
}

export function requireReason(reason: string | null | undefined, what = "o motivo"): string {
  const r = (reason ?? "").trim();
  if (r.length < 3) throw new ServiceError(`Informe ${what} (mínimo de 3 letras).`);
  if (r.length > 500) throw new ServiceError("O motivo é longo demais (máximo de 500 letras).");
  return r;
}

/** Trava a linha da sessão até o fim da transação: impede fechar e lançar ao mesmo tempo. */
export async function lockSession(tx: Db, actor: Actor, sessionId: string) {
  await tx.$queryRaw`SELECT id FROM cash_sessions WHERE id = ${sessionId} FOR UPDATE`;
  const s = await tx.cashSession.findFirst({ where: { id: sessionId, restaurantId: actor.restaurantId } });
  if (!s) throw new ServiceError("Caixa não encontrado.", "NOT_FOUND");
  return s;
}

export interface OpenSessionInput {
  registerId: string;
  shiftId: string;
  businessDate: string;
  openingFloatCents: number;
  floatMode: "NEW_OPENING" | "TRANSFER";
  transferredFromId?: string | null;
  note?: string | null;
}

export async function openSession(actor: Actor, input: OpenSessionInput) {
  assertCan(actor, "session.open");
  await assertCanOpenCash(actor.restaurantId);

  if (!isIsoDate(input.businessDate)) throw new ServiceError("Data inválida.");
  const today = todayIso();
  if (input.businessDate > today) throw new ServiceError("Não é possível abrir caixa em data futura.");
  if (!can(actor.role, "closing.correct") && input.businessDate < addDays(today, -1)) {
    throw new ServiceError("Operadores só abrem caixa de hoje ou de ontem. Peça a um gerente para datas anteriores.", "FORBIDDEN");
  }
  if (!Number.isInteger(input.openingFloatCents) || input.openingFloatCents < 0 || input.openingFloatCents > MAX_CENTS) {
    throw new ServiceError("Fundo de abertura inválido.");
  }
  const note = input.note?.trim() || null;

  try {
    return await prisma.$transaction(async (tx) => {
      const [register, shift] = await Promise.all([
        tx.cashRegister.findFirst({ where: { id: input.registerId, restaurantId: actor.restaurantId } }),
        tx.shift.findFirst({ where: { id: input.shiftId, restaurantId: actor.restaurantId } }),
      ]);
      if (!register || !register.active) throw new ServiceError("Escolha um caixa ativo.");
      if (!shift || !shift.active) throw new ServiceError("Escolha um turno ativo.");

      const existing = await tx.cashSession.findUnique({
        where: {
          registerId_shiftId_businessDate: {
            registerId: register.id,
            shiftId: shift.id,
            businessDate: toDbDate(input.businessDate),
          },
        },
      });
      if (existing) return { session: existing, created: false };

      const openElsewhere = await tx.cashSession.findFirst({
        where: { registerId: register.id, status: "OPEN" },
        include: { shift: true },
      });
      if (openElsewhere) {
        throw new ServiceError(
          `${register.name} já está aberto no turno ${openElsewhere.shift.name} de ${fromDbDate(openElsewhere.businessDate)}. Feche-o antes de abrir outro.`,
          "CONFLICT",
        );
      }

      let transferredFromId: string | null = null;
      if (input.floatMode === "TRANSFER") {
        if (!input.transferredFromId) throw new ServiceError("Escolha de qual turno o fundo foi transferido.");
        const source = await tx.cashSession.findFirst({
          where: { id: input.transferredFromId, restaurantId: actor.restaurantId },
          include: { shift: true },
        });
        if (!source) throw new ServiceError("Turno de origem do fundo não encontrado.");
        if (source.registerId !== register.id || fromDbDate(source.businessDate) !== input.businessDate) {
          throw new ServiceError("A transferência precisa vir do mesmo caixa, no mesmo dia.");
        }
        if (source.shift.sortOrder >= shift.sortOrder) {
          throw new ServiceError("O fundo só pode ser transferido de um turno anterior.");
        }
        if (source.status !== "CLOSED" && source.status !== "CORRECTED") {
          throw new ServiceError(`Feche o caixa do turno ${source.shift.name} antes de transferir o fundo, ou use Nova abertura.`, "STATE");
        }
        const alreadyUsed = await tx.cashSession.findFirst({ where: { transferredFromId: source.id } });
        if (alreadyUsed) throw new ServiceError("O fundo deste turno já foi transferido para outro caixa.", "CONFLICT");
        transferredFromId = source.id;
      }

      const created = await tx.cashSession.create({
        data: {
          restaurantId: actor.restaurantId,
          registerId: register.id,
          shiftId: shift.id,
          businessDate: toDbDate(input.businessDate),
          responsibleId: actor.userId,
          openingFloatCents: input.openingFloatCents,
          floatMode: input.floatMode,
          transferredFromId,
          openingNote: note,
        },
      });
      await audit(tx, actor, {
        action: "session.open",
        entity: "cash_session",
        entityId: created.id,
        sessionId: created.id,
        newValue: {
          register: register.name,
          shift: shift.name,
          businessDate: input.businessDate,
          openingFloat: formatBRL(input.openingFloatCents),
          openingFloatCents: input.openingFloatCents,
          floatMode: input.floatMode,
          transferredFromId,
        },
      });
      return { session: created, created: true };
    });
  } catch (err) {
    // duas aberturas ao mesmo tempo: a segunda cai aqui, e devolvemos a que ganhou
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const existing = await prisma.cashSession.findUnique({
        where: {
          registerId_shiftId_businessDate: {
            registerId: input.registerId,
            shiftId: input.shiftId,
            businessDate: toDbDate(input.businessDate),
          },
        },
      });
      if (existing) return { session: existing, created: false };
    }
    throw err;
  }
}

/** Corrige o fundo de abertura. Só gerente/admin, com motivo, e deixa rastro. */
export async function correctOpeningFloat(actor: Actor, sessionId: string, newFloatCents: number, reason: string) {
  assertCan(actor, "closing.correct");
  const why = requireReason(reason);
  if (!Number.isInteger(newFloatCents) || newFloatCents < 0 || newFloatCents > MAX_CENTS) {
    throw new ServiceError("Fundo de abertura inválido.");
  }
  return prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, actor, sessionId);
    if (s.status !== "OPEN" && s.status !== "REOPENED") {
      throw new ServiceError("Reabra o caixa antes de corrigir o fundo.", "STATE");
    }
    if (s.openingFloatCents === newFloatCents) throw new ServiceError("O fundo informado é igual ao atual.");
    const updated = await tx.cashSession.update({ where: { id: s.id }, data: { openingFloatCents: newFloatCents } });
    await recordAdjustment(tx, actor, {
      sessionId: s.id,
      entity: "cash_session",
      entityId: s.id,
      field: "Fundo de abertura",
      oldValue: formatBRL(s.openingFloatCents),
      newValue: formatBRL(newFloatCents),
      reason: why,
    });
    await audit(tx, actor, {
      action: "session.float_corrected",
      entity: "cash_session",
      entityId: s.id,
      sessionId: s.id,
      oldValue: { openingFloatCents: s.openingFloatCents },
      newValue: { openingFloatCents: newFloatCents },
      reason: why,
    });
    return updated;
  });
}
