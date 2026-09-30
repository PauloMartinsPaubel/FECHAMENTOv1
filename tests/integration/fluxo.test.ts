import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { todayIso } from "@/lib/dates";
import { openSession } from "@/server/services/sessions";
import {
  cancelSale, createMovement, createMovementsBatch, registerCancellation, updateMovement, voidMovement,
} from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession, reopenSession } from "@/server/services/closing";
import { loadSessionBundle } from "@/server/loaders";
import { ServiceError } from "@/server/errors";

const R = (n: number) => Math.round(n * 100);
let env: Env;

beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function newSession(date: string, shift = env.morning, float = R(100), register = env.register, actor = env.operator) {
  const { session } = await openSession(actor, {
    registerId: register.id, shiftId: shift.id, businessDate: date, openingFloatCents: float, floatMode: "NEW_OPENING",
  });
  return session;
}
const today = () => todayIso();

describe("abertura de caixa", () => {
  it("abre com fundo de R$ 100 e grava auditoria", async () => {
    const s = await newSession(today());
    expect(s.status).toBe("OPEN");
    expect(s.openingFloatCents).toBe(R(100));
    const log = await prisma.auditLog.findFirst({ where: { action: "session.open", sessionId: s.id } });
    expect(log?.userName).toBe("João Operador");
  });

  it("abrir de novo o mesmo caixa, turno e data devolve o existente", async () => {
    const a = await newSession(today());
    const { session: b, created } = await openSession(env.operator, {
      registerId: env.register.id, shiftId: env.morning.id, businessDate: today(), openingFloatCents: R(500), floatMode: "NEW_OPENING",
    });
    expect(created).toBe(false);
    expect(b.id).toBe(a.id);
    expect(b.openingFloatCents).toBe(R(100));
  });

  it("recusa data futura e fundo negativo", async () => {
    await expect(
      openSession(env.operator, { registerId: env.register.id, shiftId: env.evening.id, businessDate: "2999-01-01", openingFloatCents: 0, floatMode: "NEW_OPENING" }),
    ).rejects.toThrow(/futura/);
    await expect(
      openSession(env.operator, { registerId: env.register.id, shiftId: env.evening.id, businessDate: today(), openingFloatCents: -1, floatMode: "NEW_OPENING" }),
    ).rejects.toThrow(/Fundo/);
  });

  it("operador não abre data antiga; gerente abre", async () => {
    await expect(
      openSession(env.operator, { registerId: env.registers[3].id, shiftId: env.morning.id, businessDate: "2020-01-10", openingFloatCents: R(100), floatMode: "NEW_OPENING" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const ok = await openSession(env.manager, { registerId: env.registers[3].id, shiftId: env.morning.id, businessDate: "2020-01-10", openingFloatCents: R(100), floatMode: "NEW_OPENING" });
    expect(ok.created).toBe(true);
  });

  it("um caixa não abre em dois turnos ao mesmo tempo", async () => {
    await expect(
      openSession(env.operator, { registerId: env.register.id, shiftId: env.evening.id, businessDate: today(), openingFloatCents: R(100), floatMode: "NEW_OPENING" }),
    ).rejects.toThrow(/já está aberto/);
  });
});

describe("lançamentos", () => {
  let sessionId: string;
  beforeAll(async () => {
    sessionId = (await newSession(today())).id;
  });

  it("venda em dinheiro tem efeito em faturamento e gaveta; PIX só em faturamento", async () => {
    const cash = await createMovement(env.operator, sessionId, {
      type: "VENDA", amountCents: R(900), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro"),
    });
    expect([cash.movement.revenueEffect, cash.movement.cashEffect]).toEqual([1, 1]);
    const pix = await createMovement(env.operator, sessionId, {
      type: "VENDA", amountCents: R(50), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"),
    });
    expect([pix.movement.revenueEffect, pix.movement.cashEffect]).toEqual([1, 0]);
  });

  it("idempotência: o mesmo envio duas vezes grava uma só vez", async () => {
    const input = {
      type: "VENDA" as const, amountCents: R(10), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), idempotencyKey: "form-abc",
    };
    const a = await createMovement(env.operator, sessionId, input);
    const b = await createMovement(env.operator, sessionId, input);
    expect(a.duplicate).toBe(false);
    expect(b.duplicate).toBe(true);
    expect(b.movement.id).toBe(a.movement.id);
    const count = await prisma.cashMovement.count({ where: { sessionId, idempotencyKey: "form-abc" } });
    expect(count).toBe(1);
  });

  it("dois envios simultâneos também não duplicam", async () => {
    const input = {
      type: "VENDA" as const, amountCents: R(11), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), idempotencyKey: "form-race",
    };
    await Promise.allSettled([createMovement(env.operator, sessionId, input), createMovement(env.operator, sessionId, input)]);
    expect(await prisma.cashMovement.count({ where: { sessionId, idempotencyKey: "form-race" } })).toBe(1);
  });

  it("pedido repetido com mesmo canal, forma e valor pede confirmação", async () => {
    const base = {
      type: "VENDA" as const, amountCents: R(77), orderNumber: "A-1", channelId: env.ch("iFood"), paymentMethodId: env.pm("Pagamento online"),
    };
    await createMovement(env.operator, sessionId, base);
    await expect(createMovement(env.operator, sessionId, base)).rejects.toMatchObject({ code: "DUPLICATE_SUSPECT" });
    const ok = await createMovement(env.operator, sessionId, { ...base, allowDuplicate: true });
    expect(ok.duplicate).toBe(false);
  });

  it("regras de forma: ticket exige bandeira; bandeira fora de ticket é recusada", async () => {
    await expect(
      createMovement(env.operator, sessionId, { type: "VENDA", amountCents: R(5), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Tickets / Vales") }),
    ).rejects.toThrow(/bandeira/i);
    await expect(
      createMovement(env.operator, sessionId, { type: "VENDA", amountCents: R(5), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), ticketBrandId: env.brand("VR") }),
    ).rejects.toThrow(/Tickets/);
  });

  it("sangria exige destino, é sempre em dinheiro e não tem canal", async () => {
    await expect(createMovement(env.operator, sessionId, { type: "SANGRIA", amountCents: R(10) })).rejects.toThrow(/destino/);
    const m = await createMovement(env.operator, sessionId, { type: "SANGRIA", amountCents: R(10), description: "Cofre", channelId: env.ch("Balcão") });
    expect([m.movement.revenueEffect, m.movement.cashEffect, m.movement.channelId]).toEqual([0, -1, null]);
    expect(m.movement.paymentMethodId).toBe(env.pm("Dinheiro"));
  });

  it("valor zero ou negativo é recusado", async () => {
    await expect(createMovement(env.operator, sessionId, { type: "SUPRIMENTO", amountCents: 0, description: "x" })).rejects.toThrow(/maior que zero/);
    await expect(createMovement(env.operator, sessionId, { type: "SUPRIMENTO", amountCents: -5, description: "x" })).rejects.toThrow(/maior que zero/);
  });

  it("o banco recusa valor inválido mesmo fora do serviço (CHECK)", async () => {
    await expect(
      prisma.cashMovement.create({
        data: { restaurantId: env.restaurantId, sessionId, type: "SUPRIMENTO", amountCents: -1, revenueEffect: 0, cashEffect: 1, createdById: env.operator.userId },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.cashMovement.create({
        data: { restaurantId: env.restaurantId, sessionId, type: "VENDA", amountCents: 100, revenueEffect: 1, cashEffect: 0, createdById: env.operator.userId },
      }),
    ).rejects.toThrow(); // venda sem canal nem forma
  });

  it("lote: tudo ou nada", async () => {
    const before = await prisma.cashMovement.count({ where: { sessionId } });
    await expect(
      createMovementsBatch(env.operator, sessionId, [
        { type: "VENDA", amountCents: R(1), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX") },
        { type: "VENDA", amountCents: R(2), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Tickets / Vales") }, // sem bandeira
      ], "lote-1"),
    ).rejects.toThrow();
    expect(await prisma.cashMovement.count({ where: { sessionId } })).toBe(before);
    const ok = await createMovementsBatch(env.operator, sessionId, [
      { type: "VENDA", amountCents: R(1), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX") },
      { type: "VENDA", amountCents: R(2), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX") },
    ], "lote-2");
    expect(ok).toHaveLength(2);
  });
});

describe("edição, anulação e cancelamento deixam rastro e saem das somas", () => {
  let sessionId: string;
  beforeAll(async () => {
    sessionId = (await newSession(today(), env.morning, R(100), env.registers[1])).id;
  });

  it("editar exige motivo, grava campo a campo e recalcula", async () => {
    const m = (await createMovement(env.manager, sessionId, {
      type: "VENDA", amountCents: R(100), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro"),
    })).movement;
    await expect(updateMovement(env.operator, m.id, { amountCents: R(120) }, "")).rejects.toThrow(/motivo/);
    await updateMovement(env.operator, m.id, { amountCents: R(120) }, "Digitei errado");
    const adj = await prisma.adjustment.findMany({ where: { entityId: m.id } });
    expect(adj).toHaveLength(1);
    expect(adj[0]).toMatchObject({ oldValue: "R$ 100,00", newValue: "R$ 120,00", reason: "Digitei errado", userId: env.operator.userId });
    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    expect(b.evaluation.summary.revenueCents).toBe(R(120));
  });

  it("anular não apaga e tira da soma", async () => {
    const m = (await createMovement(env.operator, sessionId, {
      type: "VENDA", amountCents: R(33), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"),
    })).movement;
    await voidMovement(env.operator, m.id, "Lançado em duplicidade");
    const row = await prisma.cashMovement.findUniqueOrThrow({ where: { id: m.id } });
    expect(row.status).toBe("VOIDED");
    expect(row.voidReason).toBe("Lançado em duplicidade");
    await expect(voidMovement(env.operator, m.id, "de novo")).rejects.toThrow(/já está/);
    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    expect(b.evaluation.summary.byKind.PIX.netCents).toBe(0);
  });

  it("cancelar venda tira do faturamento e da gaveta, e guarda o cancelamento", async () => {
    const m = (await createMovement(env.operator, sessionId, {
      type: "VENDA", amountCents: R(50), orderNumber: "777", channelId: env.ch("Telefone/Tablet"), paymentMethodId: env.pm("Dinheiro"),
    })).movement;
    const before = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    const c = await cancelSale(env.operator, m.id, { reason: "Cliente desistiu" });
    const after = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    expect(before.evaluation.summary.revenueCents - after.evaluation.summary.revenueCents).toBe(R(50));
    expect(before.evaluation.summary.cash.expectedCents - after.evaluation.summary.cash.expectedCents).toBe(R(50));
    expect(after.evaluation.summary.cancellationsCents).toBe(R(50));
    expect(c).toMatchObject({ orderNumber: "777", amountCents: R(50), movementId: m.id });
    expect((await prisma.cashMovement.findUniqueOrThrow({ where: { id: m.id } })).status).toBe("CANCELLED");
  });

  it("cancelamento avulso de pedido que está lançado como venda é recusado", async () => {
    await createMovement(env.operator, sessionId, {
      type: "VENDA", amountCents: R(60), orderNumber: "888", channelId: env.ch("iFood"), paymentMethodId: env.pm("Pagamento online"),
    });
    await expect(
      registerCancellation(env.operator, sessionId, { orderNumber: "888", channelId: env.ch("iFood"), amountCents: R(60), reason: "x cancelou" }),
    ).rejects.toMatchObject({ code: "DUPLICATE_SUSPECT" });
  });

  it("cancelamento avulso (nunca lançado) é só informativo", async () => {
    const before = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    await registerCancellation(env.operator, sessionId, {
      orderNumber: "999", channelId: env.ch("99Food"), paymentMethodId: env.pm("Pagamento online"), amountCents: R(45), reason: "Cancelado na plataforma",
    });
    const after = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    expect(after.evaluation.summary.revenueCents).toBe(before.evaluation.summary.revenueCents);
    expect(after.evaluation.summary.cancellationsCents).toBe(before.evaluation.summary.cancellationsCents + R(45));
  });
});

describe("fechamento, reabertura e correção", () => {
  let sessionId: string;

  beforeAll(async () => {
    sessionId = (await newSession(today(), env.morning, R(100), env.registers[2])).id;
    const m = (type: "VENDA", kind: string, cents: number, extra: object = {}) =>
      createMovement(env.operator, sessionId, { type, amountCents: cents, channelId: env.ch("Balcão"), paymentMethodId: env.pm(kind), ...extra });
    await m("VENDA", "Dinheiro", R(900));
    await m("VENDA", "Cartão de crédito", R(2000));
    await m("VENDA", "Cartão de débito", R(1000));
    await m("VENDA", "PIX", R(800));
    await m("VENDA", "Tickets / Vales", R(200), { ticketBrandId: env.brand("Alelo") });
    await m("VENDA", "Tickets / Vales", R(300), { ticketBrandId: env.brand("VR") });
    await m("VENDA", "Tickets / Vales", R(150), { ticketBrandId: env.brand("Ticket Restaurante") });
    await createMovement(env.operator, sessionId, { type: "SANGRIA", amountCents: R(300), description: "Cofre" });
  });

  it("não fecha com conferência incompleta", async () => {
    await expect(closeSession(env.operator, sessionId, {})).rejects.toThrow(/Falta conferir/);
  });

  const conferido = (over: Record<string, number> = {}) => ({
    cash: R(700),
    [`pm:${""}`]: 0,
    ...over,
  });

  it("exige justificativa quando passa da tolerância, e fecha com ela", async () => {
    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    const k = (label: string) => b.evaluation.lines.find((l) => l.fullLabel === label || l.label === label)!.key;
    await saveConference(env.operator, sessionId, {
      cash: R(680), // falta de 20 (TESTE 2)
      [k("Cartão de crédito")]: R(2000),
      [k("Cartão de débito")]: R(950), // -50 (TESTE 3)
      [k("PIX")]: R(800),
      [k("Alelo")]: R(200),
      [k("VR")]: R(300),
      [k("Ticket Restaurante")]: R(150),
    });
    const ev = (await loadSessionBundle(prisma, env.restaurantId, sessionId)).evaluation;
    expect(ev.summary.revenueCents).toBe(R(5350)); // TESTE 5
    expect(ev.summary.cash.expectedCents).toBe(R(700));
    expect(ev.divergence.netCents).toBe(-R(70));
    expect(ev.divergence.status).toBe("FALTA");
    const byGroup = Object.fromEntries(ev.divergence.byGroup.map((g) => [g.group, g.differenceCents]));
    expect(byGroup.CASH).toBe(-R(20));
    expect(byGroup.DEBIT).toBe(-R(50));

    await expect(closeSession(env.operator, sessionId, {})).rejects.toThrow(/justificativa/i);
    const res = await closeSession(env.operator, sessionId, {
      justification: "Máquina de cartão apresentou diferença de R$ 50 e faltaram R$ 20 no troco.",
      notes: "Turno tranquilo",
    });
    expect(res).toMatchObject({ status: "FALTA", revision: 1, sessionStatus: "CLOSED" });
  });

  it("o fechamento guarda os números certos, o fundo separado do faturamento e a foto completa", async () => {
    const c = await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId } });
    expect(c).toMatchObject({
      revenueCents: R(5350), floatCents: R(100), controlledCents: R(5450), cashExpectedCents: R(700), cashCountedCents: R(680),
      cashDiffCents: -R(20), cardsDiffCents: -R(50), totalDiffCents: -R(70), absDiffCents: R(70), withdrawalsCents: R(300),
    });
    const snap = c.snapshot as any;
    expect(snap.totals.revenueCents).toBe(R(5350));
    expect(snap.floatCents).toBe(R(100));
    expect(snap.session.status).toBe("CLOSED");
    expect(snap.justification).toContain("Máquina de cartão");
    const details = await prisma.closingDetail.findMany({ where: { closingId: c.id, section: "MATRIX" } });
    expect(details.reduce((a, d) => a + d.amountCents, 0)).toBe(R(5350));
    const conf = await prisma.closingConference.findMany({ where: { sessionId } });
    expect(conf.every((x) => x.closingId === c.id)).toBe(true);
  });

  it("caixa fechado não aceita mais nada", async () => {
    await expect(
      createMovement(env.operator, sessionId, { type: "SUPRIMENTO", amountCents: R(5), description: "x" }),
    ).rejects.toThrow(/fechado/);
    await expect(closeSession(env.operator, sessionId, {})).rejects.toThrow(/já está fechado/);
    await expect(saveConference(env.operator, sessionId, { cash: 1 })).rejects.toThrow(/fechado/);
  });

  it("operador não reabre; gerente reabre com motivo", async () => {
    await expect(reopenSession(env.operator, sessionId, "quero corrigir")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reopenSession(env.manager, sessionId, "")).rejects.toThrow(/motivo/);
    await reopenSession(env.manager, sessionId, "Contagem do dinheiro estava errada");
    const s = await prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId } });
    expect(s.status).toBe("REOPENED");
    expect(s.reopenCount).toBe(1);
  });

  it("caixa reaberto: operador não edita, gerente corrige com motivo e fecha como CORRIGIDO", async () => {
    await expect(saveConference(env.operator, sessionId, { cash: R(700) })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveConference(env.manager, sessionId, { cash: R(700) })).rejects.toThrow(/motivo/);
    await saveConference(env.manager, sessionId, { cash: R(700) }, "Recontagem da gaveta");

    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    const debit = b.evaluation.lines.find((l) => l.label === "Cartão de débito")!;
    await saveConference(env.manager, sessionId, { [debit.key]: R(1000) }, "Comprovante da máquina achado");
    const after = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    expect(after.evaluation.divergence.status).toBe("CORRETO");

    await expect(closeSession(env.manager, sessionId, {})).rejects.toThrow(/o que foi corrigido/);
    const res = await closeSession(env.manager, sessionId, { correctionReason: "Recontagem e comprovante" });
    expect(res).toMatchObject({ status: "CORRETO", revision: 2, sessionStatus: "CORRECTED" });

    const adj = await prisma.adjustment.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });
    const fields = adj.map((a) => a.field);
    expect(fields).toEqual(expect.arrayContaining(["Situação do caixa", "Conferência: Dinheiro", "Divergência total", "Dinheiro contado"]));
    const contado = adj.find((a) => a.field === "Dinheiro contado")!;
    expect(contado).toMatchObject({ oldValue: "R$ 680,00", newValue: "R$ 700,00", userId: env.manager.userId });
    const total = adj.find((a) => a.field === "Divergência total")!;
    expect(total).toMatchObject({ oldValue: "-R$ 70,00", newValue: "R$ 0,00" });
  });

  it("um fechamento por sessão: o segundo fechamento atualiza, não duplica", async () => {
    expect(await prisma.cashClosing.count({ where: { sessionId } })).toBe(1);
    const c = await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId } });
    expect(c.revision).toBe(2);
    expect(c.status).toBe("CORRETO");
  });
});

describe("imutabilidade no banco", () => {
  it("auditoria e ajustes não aceitam UPDATE nem DELETE", async () => {
    const log = await prisma.auditLog.findFirstOrThrow();
    await expect(prisma.auditLog.update({ where: { id: log.id }, data: { action: "adulterado" } })).rejects.toThrow(/somente inserção/);
    await expect(prisma.auditLog.delete({ where: { id: log.id } })).rejects.toThrow(/somente inserção/);
    const adj = await prisma.adjustment.findFirstOrThrow();
    await expect(prisma.adjustment.update({ where: { id: adj.id }, data: { newValue: "0" } })).rejects.toThrow();
    await expect(prisma.adjustment.delete({ where: { id: adj.id } })).rejects.toThrow();
  });
  it("lançamentos, cancelamentos, fechamentos e sessões não podem ser apagados", async () => {
    const m = await prisma.cashMovement.findFirstOrThrow();
    await expect(prisma.cashMovement.delete({ where: { id: m.id } })).rejects.toThrow(/não podem ser apagados/);
    const c = await prisma.cancellation.findFirstOrThrow();
    await expect(prisma.cancellation.delete({ where: { id: c.id } })).rejects.toThrow();
    const cl = await prisma.cashClosing.findFirstOrThrow();
    await expect(prisma.cashClosing.delete({ where: { id: cl.id } })).rejects.toThrow();
  });
  it("só existe uma forma de pagamento Dinheiro", async () => {
    await expect(
      prisma.paymentMethod.create({ data: { restaurantId: env.restaurantId, name: "Dinheiro 2", kind: "CASH" } }),
    ).rejects.toThrow();
  });
});

describe("permissões e escopo", () => {
  it("operador não acessa caixa fechado de outro operador", async () => {
    const sid = (await prisma.cashSession.findFirstOrThrow({ where: { status: "CORRECTED" } })).id;
    // João abriu e fechou; Maria não tem nada a ver com ele
    const { canAccessSession } = await import("@/server/services/sessions");
    const s = await prisma.cashSession.findUniqueOrThrow({ where: { id: sid } });
    expect(canAccessSession(env.operator2, s)).toBe(false);
    expect(canAccessSession(env.manager, s)).toBe(true);
  });
});
