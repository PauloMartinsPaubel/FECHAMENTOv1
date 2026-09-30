import { Prisma } from "@/generated/prisma/client";
import {
  AdjustmentSpec,
  classifyMovement,
  Effects,
  FinanceError,
  formatBRL,
  MAX_CENTS,
  MOVEMENT_TYPES,
  MovementType,
  PaymentKind,
} from "@/lib/finance";
import { Actor, assertCan } from "../actor";
import { audit, recordAdjustment } from "../audit";
import { Db, prisma } from "../db";
import { ServiceError } from "../errors";
import { assertEditable, EditMode, lockSession, requireReason } from "./sessions";

export interface MovementInput {
  type: MovementType;
  amountCents: number;
  channelId?: string | null;
  paymentMethodId?: string | null;
  ticketBrandId?: string | null;
  orderNumber?: string | null;
  description?: string | null;
  employeeName?: string | null;
  occurredAt?: Date | null;
  /** o formulário gera um por tela: clique duplo ou reenvio não duplica o lançamento */
  idempotencyKey?: string | null;
  adjustment?: AdjustmentSpec;
  /** confirma um lançamento que parece duplicado */
  allowDuplicate?: boolean;
  /** obrigatório quando o caixa foi reaberto para correção */
  reason?: string | null;
}

const DESCRIPTION_REQUIRED: MovementType[] = ["SUPRIMENTO", "SANGRIA", "DESPESA", "ESTORNO", "AJUSTE"];
const DESCRIPTION_LABEL: Record<string, string> = {
  SUPRIMENTO: "a origem do suprimento",
  SANGRIA: "o destino da sangria",
  DESPESA: "a descrição da despesa",
  ESTORNO: "o motivo do estorno",
  AJUSTE: "o motivo do ajuste",
};

function clean(value: string | null | undefined, max: number, label: string): string | null {
  const v = (value ?? "").trim();
  if (!v) return null;
  if (v.length > max) throw new ServiceError(`${label} é longo demais (máximo de ${max} caracteres).`);
  return v;
}

interface Shape {
  type: MovementType;
  amountCents: number;
  channelId: string | null;
  paymentMethodId: string | null;
  ticketBrandId: string | null;
  paymentKind: PaymentKind | null;
  orderNumber: string | null;
  description: string | null;
  employeeName: string | null;
  occurredAt: Date | null;
  effects: Effects;
  names: { channel: string | null; method: string | null; brand: string | null };
}

/** Valida tudo contra o cadastro do restaurante e decide os efeitos. */
async function resolveShape(db: Db, actor: Actor, input: MovementInput): Promise<Shape> {
  if (!MOVEMENT_TYPES.includes(input.type)) throw new ServiceError("Tipo de movimentação inválido.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new ServiceError("Informe um valor maior que zero.");
  if (input.amountCents > MAX_CENTS) throw new ServiceError("Valor acima do máximo permitido.");

  const description = clean(input.description, 300, "A descrição");
  if (DESCRIPTION_REQUIRED.includes(input.type) && !description) {
    throw new ServiceError(`Informe ${DESCRIPTION_LABEL[input.type]}.`);
  }
  const orderNumber = clean(input.orderNumber, 40, "O número do pedido");
  const employeeName = clean(input.employeeName, 100, "O nome do funcionário") ?? actor.name;

  let methodId = input.paymentMethodId || null;
  let channelId = input.channelId || null;
  let brandId = input.ticketBrandId || null;

  // Suprimento e sangria são sempre em dinheiro e não têm canal
  if (input.type === "SUPRIMENTO" || input.type === "SANGRIA") {
    const cash = await db.paymentMethod.findFirst({ where: { restaurantId: actor.restaurantId, kind: "CASH" } });
    if (!cash) throw new ServiceError("Cadastre a forma de pagamento Dinheiro antes de lançar.");
    methodId = cash.id;
    channelId = null;
    brandId = null;
  }
  if (input.type === "DESPESA") {
    channelId = null;
    brandId = null;
  }

  const [method, channel, brand] = await Promise.all([
    methodId ? db.paymentMethod.findFirst({ where: { id: methodId, restaurantId: actor.restaurantId } }) : null,
    channelId ? db.salesChannel.findFirst({ where: { id: channelId, restaurantId: actor.restaurantId } }) : null,
    brandId ? db.ticketBrand.findFirst({ where: { id: brandId, restaurantId: actor.restaurantId } }) : null,
  ]);
  if (methodId && !method) throw new ServiceError("Forma de pagamento não encontrada.");
  if (channelId && !channel) throw new ServiceError("Canal de venda não encontrado.");
  if (brandId && !brand) throw new ServiceError("Bandeira de ticket não encontrada.");

  const paymentKind = (method?.kind as PaymentKind | undefined) ?? null;
  let effects: Effects;
  try {
    effects = classifyMovement({
      type: input.type,
      paymentKind,
      channelId,
      ticketBrandId: brandId,
      adjustment: input.adjustment,
    });
  } catch (err) {
    if (err instanceof FinanceError) throw new ServiceError(err.message);
    throw err;
  }

  return {
    type: input.type,
    amountCents: input.amountCents,
    channelId,
    paymentMethodId: methodId,
    ticketBrandId: brandId,
    paymentKind,
    orderNumber,
    description,
    employeeName,
    occurredAt: input.occurredAt ?? null,
    effects,
    names: { channel: channel?.name ?? null, method: method?.name ?? null, brand: brand?.name ?? null },
  };
}

function needsActive(shape: Shape, db: { channelActive: boolean | null; methodActive: boolean | null; brandActive: boolean | null }) {
  if (db.channelActive === false) throw new ServiceError(`O canal ${shape.names.channel} está desativado.`);
  if (db.methodActive === false) throw new ServiceError(`A forma de pagamento ${shape.names.method} está desativada.`);
  if (db.brandActive === false) throw new ServiceError(`A bandeira ${shape.names.brand} está desativada.`);
}

const TYPE_LABEL: Record<MovementType, string> = {
  VENDA: "Venda",
  SUPRIMENTO: "Suprimento",
  SANGRIA: "Sangria",
  DESPESA: "Despesa",
  ESTORNO: "Estorno",
  AJUSTE: "Ajuste",
};

async function createInTx(tx: Db, actor: Actor, session: { id: string; status: string }, mode: EditMode, input: MovementInput) {
  const reason = mode === "correction" ? requireReason(input.reason, "o motivo da correção") : null;

  if (input.idempotencyKey) {
    const dup = await tx.cashMovement.findUnique({
      where: { sessionId_idempotencyKey: { sessionId: session.id, idempotencyKey: input.idempotencyKey } },
    });
    if (dup) return { movement: dup, duplicate: true };
  }

  const shape = await resolveShape(tx, actor, input);

  // só cadastros ativos podem ser usados em novos lançamentos
  const [ch, pm, tb] = await Promise.all([
    shape.channelId ? tx.salesChannel.findUnique({ where: { id: shape.channelId }, select: { active: true } }) : null,
    shape.paymentMethodId ? tx.paymentMethod.findUnique({ where: { id: shape.paymentMethodId }, select: { active: true } }) : null,
    shape.ticketBrandId ? tx.ticketBrand.findUnique({ where: { id: shape.ticketBrandId }, select: { active: true } }) : null,
  ]);
  needsActive(shape, { channelActive: ch?.active ?? null, methodActive: pm?.active ?? null, brandActive: tb?.active ?? null });

  // mesmo pedido, canal, forma, bandeira e valor já lançados: provável clique repetido
  if (shape.orderNumber && (shape.type === "VENDA" || shape.type === "ESTORNO") && !input.allowDuplicate) {
    const same = await tx.cashMovement.findFirst({
      where: {
        sessionId: session.id,
        status: "ACTIVE",
        type: shape.type,
        orderNumber: shape.orderNumber,
        channelId: shape.channelId,
        paymentMethodId: shape.paymentMethodId,
        ticketBrandId: shape.ticketBrandId,
        amountCents: shape.amountCents,
      },
    });
    if (same) {
      throw new ServiceError(
        `Já existe ${TYPE_LABEL[shape.type].toLowerCase()} do pedido ${shape.orderNumber} com o mesmo canal, forma e valor (${formatBRL(shape.amountCents)}). Confirme para lançar mesmo assim.`,
        "DUPLICATE_SUSPECT",
      );
    }
  }

  const movement = await tx.cashMovement.create({
    data: {
      restaurantId: actor.restaurantId,
      sessionId: session.id,
      type: shape.type,
      amountCents: shape.amountCents,
      revenueEffect: shape.effects.revenueEffect,
      cashEffect: shape.effects.cashEffect,
      channelId: shape.channelId,
      paymentMethodId: shape.paymentMethodId,
      ticketBrandId: shape.ticketBrandId,
      orderNumber: shape.orderNumber,
      description: shape.description,
      employeeName: shape.employeeName,
      occurredAt: shape.occurredAt ?? undefined,
      createdById: actor.userId,
      idempotencyKey: input.idempotencyKey || null,
    },
  });

  const summary = {
    type: shape.type,
    amount: formatBRL(shape.amountCents),
    amountCents: shape.amountCents,
    channel: shape.names.channel,
    method: shape.names.method,
    brand: shape.names.brand,
    orderNumber: shape.orderNumber,
    description: shape.description,
    revenueEffect: shape.effects.revenueEffect,
    cashEffect: shape.effects.cashEffect,
  };
  await audit(tx, actor, {
    action: `movement.create.${shape.type.toLowerCase()}`,
    entity: "cash_movement",
    entityId: movement.id,
    sessionId: session.id,
    newValue: summary,
    reason,
  });
  if (reason) {
    await recordAdjustment(tx, actor, {
      sessionId: session.id,
      closingId: null,
      entity: "cash_movement",
      entityId: movement.id,
      field: `${TYPE_LABEL[shape.type]} incluída`,
      oldValue: null,
      newValue: `${formatBRL(shape.amountCents)}${shape.names.method ? ` em ${shape.names.method}` : ""}${shape.names.channel ? ` (${shape.names.channel})` : ""}`,
      reason,
    });
  }
  return { movement, duplicate: false };
}

export async function createMovement(actor: Actor, sessionId: string, input: MovementInput) {
  try {
    return await prisma.$transaction(async (tx) => {
      const session = await lockSession(tx, actor, sessionId);
      const mode = assertEditable(actor, { ...session, restaurantId: session.restaurantId });
      return createInTx(tx, actor, session, mode, input);
    });
  } catch (err) {
    // dois envios simultâneos da mesma tela: o segundo devolve o que o primeiro gravou
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002" && input.idempotencyKey) {
      const dup = await prisma.cashMovement.findUnique({
        where: { sessionId_idempotencyKey: { sessionId, idempotencyKey: input.idempotencyKey } },
      });
      if (dup) return { movement: dup, duplicate: true };
    }
    throw err;
  }
}

/** Lançamento em lote (grade canal x forma): tudo ou nada. */
export async function createMovementsBatch(actor: Actor, sessionId: string, inputs: MovementInput[], batchKey: string) {
  if (inputs.length === 0) throw new ServiceError("Preencha ao menos um valor.");
  if (inputs.length > 200) throw new ServiceError("Lote grande demais (máximo de 200 lançamentos).");
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, actor, sessionId);
    const mode = assertEditable(actor, session);
    const created = [];
    for (let i = 0; i < inputs.length; i++) {
      created.push(await createInTx(tx, actor, session, mode, { ...inputs[i], idempotencyKey: `${batchKey}:${i}` }));
    }
    return created;
  });
}

export interface MovementPatch {
  amountCents?: number;
  channelId?: string | null;
  paymentMethodId?: string | null;
  ticketBrandId?: string | null;
  orderNumber?: string | null;
  description?: string | null;
  employeeName?: string | null;
}

const FIELD_LABEL: Record<string, string> = {
  amountCents: "Valor",
  channelId: "Canal",
  paymentMethodId: "Forma de pagamento",
  ticketBrandId: "Bandeira do ticket",
  orderNumber: "Número do pedido",
  description: "Descrição",
  employeeName: "Funcionário",
};

export async function updateMovement(actor: Actor, movementId: string, patch: MovementPatch, reason: string) {
  const why = requireReason(reason);
  return prisma.$transaction(async (tx) => {
    const found = await tx.cashMovement.findFirst({ where: { id: movementId, restaurantId: actor.restaurantId } });
    if (!found) throw new ServiceError("Lançamento não encontrado.", "NOT_FOUND");
    const session = await lockSession(tx, actor, found.sessionId);
    assertEditable(actor, session);

    const current = await tx.cashMovement.findUniqueOrThrow({
      where: { id: movementId },
      include: { channel: true, paymentMethod: true, ticketBrand: true },
    });
    if (current.status !== "ACTIVE") throw new ServiceError("Só é possível editar lançamentos ativos.", "STATE");

    const nonZero = [current.revenueEffect, current.cashEffect].filter((e) => e !== 0);
    const adjustment: AdjustmentSpec | undefined =
      current.type === "AJUSTE"
        ? { direction: (nonZero[0] ?? 1) as 1 | -1, affectsRevenue: current.revenueEffect !== 0, affectsCash: current.cashEffect !== 0 }
        : undefined;

    const merged: MovementInput = {
      type: current.type,
      amountCents: patch.amountCents ?? current.amountCents,
      channelId: patch.channelId !== undefined ? patch.channelId : current.channelId,
      paymentMethodId: patch.paymentMethodId !== undefined ? patch.paymentMethodId : current.paymentMethodId,
      ticketBrandId: patch.ticketBrandId !== undefined ? patch.ticketBrandId : current.ticketBrandId,
      orderNumber: patch.orderNumber !== undefined ? patch.orderNumber : current.orderNumber,
      description: patch.description !== undefined ? patch.description : current.description,
      employeeName: patch.employeeName !== undefined ? patch.employeeName : current.employeeName,
      adjustment,
    };
    const shape = await resolveShape(tx, actor, merged);

    const before = {
      amountCents: current.amountCents,
      channelId: current.channelId,
      paymentMethodId: current.paymentMethodId,
      ticketBrandId: current.ticketBrandId,
      orderNumber: current.orderNumber,
      description: current.description,
      employeeName: current.employeeName,
    };
    const after = {
      amountCents: shape.amountCents,
      channelId: shape.channelId,
      paymentMethodId: shape.paymentMethodId,
      ticketBrandId: shape.ticketBrandId,
      orderNumber: shape.orderNumber,
      description: shape.description,
      employeeName: shape.employeeName,
    };
    const changed = (Object.keys(before) as (keyof typeof before)[]).filter((k) => before[k] !== after[k]);
    if (changed.length === 0) throw new ServiceError("Nenhuma alteração foi informada.");

    // nomes legíveis para o histórico
    const names = new Map<string, string>();
    const ids = [before.channelId, after.channelId, before.paymentMethodId, after.paymentMethodId, before.ticketBrandId, after.ticketBrandId].filter(Boolean) as string[];
    const [chs, pms, tbs] = await Promise.all([
      tx.salesChannel.findMany({ where: { id: { in: ids } } }),
      tx.paymentMethod.findMany({ where: { id: { in: ids } } }),
      tx.ticketBrand.findMany({ where: { id: { in: ids } } }),
    ]);
    [...chs, ...pms, ...tbs].forEach((x) => names.set(x.id, x.name));
    const show = (k: keyof typeof before, v: string | number | null) => {
      if (v === null) return null;
      if (k === "amountCents") return formatBRL(v as number);
      if (k === "channelId" || k === "paymentMethodId" || k === "ticketBrandId") return names.get(v as string) ?? String(v);
      return String(v);
    };

    const updated = await tx.cashMovement.update({
      where: { id: movementId },
      data: {
        ...after,
        revenueEffect: shape.effects.revenueEffect,
        cashEffect: shape.effects.cashEffect,
      },
    });
    for (const k of changed) {
      await recordAdjustment(tx, actor, {
        sessionId: session.id,
        entity: "cash_movement",
        entityId: movementId,
        field: `${TYPE_LABEL[current.type]}: ${FIELD_LABEL[k]}`,
        oldValue: show(k, before[k]),
        newValue: show(k, after[k]),
        reason: why,
      });
    }
    await audit(tx, actor, {
      action: `movement.update.${current.type.toLowerCase()}`,
      entity: "cash_movement",
      entityId: movementId,
      sessionId: session.id,
      oldValue: before,
      newValue: after,
      reason: why,
    });
    return updated;
  });
}

/** Anula um lançamento feito por engano. Não apaga: muda o status e guarda quem, quando e por quê. */
export async function voidMovement(actor: Actor, movementId: string, reason: string) {
  const why = requireReason(reason);
  return prisma.$transaction(async (tx) => {
    const found = await tx.cashMovement.findFirst({ where: { id: movementId, restaurantId: actor.restaurantId } });
    if (!found) throw new ServiceError("Lançamento não encontrado.", "NOT_FOUND");
    const session = await lockSession(tx, actor, found.sessionId);
    assertEditable(actor, session);
    const current = await tx.cashMovement.findUniqueOrThrow({ where: { id: movementId } });
    if (current.status !== "ACTIVE") throw new ServiceError("Este lançamento já está anulado ou cancelado.", "STATE");

    const updated = await tx.cashMovement.update({
      where: { id: movementId },
      data: { status: "VOIDED", voidedAt: new Date(), voidedById: actor.userId, voidReason: why },
    });
    await recordAdjustment(tx, actor, {
      sessionId: session.id,
      entity: "cash_movement",
      entityId: movementId,
      field: `${TYPE_LABEL[current.type]}: situação (${formatBRL(current.amountCents)})`,
      oldValue: "Ativo",
      newValue: "Anulado",
      reason: why,
    });
    await audit(tx, actor, {
      action: `movement.void.${current.type.toLowerCase()}`,
      entity: "cash_movement",
      entityId: movementId,
      sessionId: session.id,
      oldValue: { status: "ACTIVE", amountCents: current.amountCents },
      newValue: { status: "VOIDED" },
      reason: why,
    });
    return updated;
  });
}

export interface CancelSaleInput {
  reason: string;
  employeeName?: string | null;
}

/** Cancela uma venda já lançada: sai do faturamento e vira registro de cancelamento. */
export async function cancelSale(actor: Actor, movementId: string, input: CancelSaleInput) {
  const why = requireReason(input.reason, "o motivo do cancelamento");
  return prisma.$transaction(async (tx) => {
    const found = await tx.cashMovement.findFirst({ where: { id: movementId, restaurantId: actor.restaurantId } });
    if (!found) throw new ServiceError("Lançamento não encontrado.", "NOT_FOUND");
    const session = await lockSession(tx, actor, found.sessionId);
    assertEditable(actor, session);
    const sale = await tx.cashMovement.findUniqueOrThrow({ where: { id: movementId } });
    if (sale.type !== "VENDA") throw new ServiceError("Só vendas podem ser canceladas. Use estorno para devolver dinheiro já recebido.");
    if (sale.status !== "ACTIVE") throw new ServiceError("Esta venda já está anulada ou cancelada.", "STATE");
    if (!sale.channelId) throw new ServiceError("Venda sem canal não pode ser cancelada.", "INTEGRITY");

    const cancellation = await tx.cancellation.create({
      data: {
        restaurantId: actor.restaurantId,
        sessionId: session.id,
        movementId: sale.id,
        orderNumber: sale.orderNumber ?? "S/N",
        channelId: sale.channelId,
        paymentMethodId: sale.paymentMethodId,
        ticketBrandId: sale.ticketBrandId,
        amountCents: sale.amountCents,
        reason: why,
        employeeName: clean(input.employeeName, 100, "O nome do funcionário") ?? actor.name,
        createdById: actor.userId,
      },
    });
    await tx.cashMovement.update({ where: { id: sale.id }, data: { status: "CANCELLED" } });
    await recordAdjustment(tx, actor, {
      sessionId: session.id,
      entity: "cash_movement",
      entityId: sale.id,
      field: `Venda: situação (${formatBRL(sale.amountCents)})`,
      oldValue: "Ativa",
      newValue: "Cancelada",
      reason: why,
    });
    await audit(tx, actor, {
      action: "cancellation.create",
      entity: "cancellation",
      entityId: cancellation.id,
      sessionId: session.id,
      oldValue: { movementId: sale.id, status: "ACTIVE", amountCents: sale.amountCents },
      newValue: { status: "CANCELLED", orderNumber: cancellation.orderNumber, amountCents: sale.amountCents },
      reason: why,
    });
    return cancellation;
  });
}

export interface StandaloneCancellationInput {
  orderNumber: string;
  channelId: string;
  paymentMethodId?: string | null;
  ticketBrandId?: string | null;
  amountCents: number;
  reason: string;
  employeeName?: string | null;
}

/**
 * Registra um pedido cancelado que NUNCA foi lançado como venda (ex.: cancelado na plataforma antes de pagar).
 * É só informativo: não mexe em faturamento nem em dinheiro. Se o pedido está lançado como venda,
 * recusa e manda cancelar pela própria venda (evita cancelar sem tirar do faturamento).
 */
export async function registerCancellation(actor: Actor, sessionId: string, input: StandaloneCancellationInput, allowDuplicate = false) {
  assertCan(actor, "movement.write");
  const why = requireReason(input.reason, "o motivo do cancelamento");
  const orderNumber = clean(input.orderNumber, 40, "O número do pedido");
  if (!orderNumber) throw new ServiceError("Informe o número do pedido.");
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0 || input.amountCents > MAX_CENTS) {
    throw new ServiceError("Informe um valor maior que zero.");
  }
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, actor, sessionId);
    assertEditable(actor, session);

    const [channel, method, brand] = await Promise.all([
      tx.salesChannel.findFirst({ where: { id: input.channelId, restaurantId: actor.restaurantId } }),
      input.paymentMethodId ? tx.paymentMethod.findFirst({ where: { id: input.paymentMethodId, restaurantId: actor.restaurantId } }) : null,
      input.ticketBrandId ? tx.ticketBrand.findFirst({ where: { id: input.ticketBrandId, restaurantId: actor.restaurantId } }) : null,
    ]);
    if (!channel) throw new ServiceError("Escolha o canal do pedido.");
    if (input.paymentMethodId && !method) throw new ServiceError("Forma de pagamento não encontrada.");
    if (input.ticketBrandId && !brand) throw new ServiceError("Bandeira de ticket não encontrada.");

    const asSale = await tx.cashMovement.findFirst({
      where: { sessionId: session.id, status: "ACTIVE", type: "VENDA", orderNumber, channelId: channel.id },
    });
    if (asSale) {
      throw new ServiceError(
        `O pedido ${orderNumber} está lançado como venda neste caixa. Use "Cancelar venda" na própria venda para tirá-lo do faturamento.`,
        "DUPLICATE_SUSPECT",
      );
    }
    if (!allowDuplicate) {
      const again = await tx.cancellation.findFirst({ where: { sessionId: session.id, orderNumber, channelId: channel.id } });
      if (again) {
        throw new ServiceError(`O pedido ${orderNumber} já tem um cancelamento registrado neste canal.`, "DUPLICATE_SUSPECT");
      }
    }

    const cancellation = await tx.cancellation.create({
      data: {
        restaurantId: actor.restaurantId,
        sessionId: session.id,
        movementId: null,
        orderNumber,
        channelId: channel.id,
        paymentMethodId: method?.id ?? null,
        ticketBrandId: brand?.id ?? null,
        amountCents: input.amountCents,
        reason: why,
        employeeName: clean(input.employeeName, 100, "O nome do funcionário") ?? actor.name,
        createdById: actor.userId,
      },
    });
    await audit(tx, actor, {
      action: "cancellation.create_informational",
      entity: "cancellation",
      entityId: cancellation.id,
      sessionId: session.id,
      newValue: { orderNumber, channel: channel.name, method: method?.name ?? null, amountCents: input.amountCents },
      reason: why,
    });
    return cancellation;
  });
}
