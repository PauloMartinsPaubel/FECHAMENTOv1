import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { todayIso } from "@/lib/dates";
import { openSession } from "@/server/services/sessions";
import { createMovement, createMovementsBatch, updateMovement } from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession } from "@/server/services/closing";
import { saveStore } from "@/server/services/admin";
import { loadSessionBundle } from "@/server/loaders";
import { buildDayReport, buildPeriodReport } from "@/server/services/queries";
import { buildExport } from "@/server/reports/export";
import { renderDayReport, renderShiftReport } from "@/lib/reports/html";
import type { ShiftReportData } from "@/lib/reports/types";

const R = (n: number) => Math.round(n * 100);
let env: Env;
let feijoada: string;
let prato: string;
let sessionId: string;
const DAY = todayIso();

beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("duas marcas no mesmo caixa", () => {
  it("só o administrador cadastra marcas; nome repetido é recusado", async () => {
    await expect(saveStore(env.operator, { name: "A Feijoada", active: true })).rejects.toThrow();
    feijoada = (await saveStore(env.admin, { name: "A Feijoada", active: true, sortOrder: 1 })).id;
    prato = (await saveStore(env.admin, { name: "Prato e Folha", active: true, sortOrder: 2 })).id;
    await expect(saveStore(env.admin, { name: "Prato e Folha", active: true })).rejects.toThrow(/Já existe/);
  });

  it("com duas marcas, venda e estorno sem marca são recusados; sangria não pede marca", async () => {
    const { session } = await openSession(env.operator, {
      registerId: env.register.id, shiftId: env.morning.id, businessDate: DAY, openingFloatCents: R(100), floatMode: "NEW_OPENING",
    });
    sessionId = session.id;
    const sale = { type: "VENDA" as const, channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro") };
    await expect(createMovement(env.operator, sessionId, { ...sale, amountCents: R(10) })).rejects.toThrow(/marca/);
    await expect(
      createMovement(env.operator, sessionId, { type: "ESTORNO", amountCents: R(5), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), description: "devolução" }),
    ).rejects.toThrow(/marca/);
    await createMovement(env.operator, sessionId, { ...sale, amountCents: R(100), storeId: feijoada });
    await createMovement(env.operator, sessionId, { type: "VENDA", amountCents: R(50), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), storeId: feijoada });
    await createMovement(env.operator, sessionId, { ...sale, amountCents: R(30), storeId: prato });
    await createMovement(env.operator, sessionId, { type: "VENDA", amountCents: R(80), channelId: env.ch("iFood"), paymentMethodId: env.pm("Pagamento online"), storeId: prato });
    await createMovement(env.operator, sessionId, { type: "ESTORNO", amountCents: R(10), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), storeId: prato, description: "devolução" });
    const sangria = await createMovement(env.operator, sessionId, { type: "SANGRIA", amountCents: R(40), description: "cofre", storeId: prato });
    expect(sangria.movement.storeId).toBeNull();
  });

  it("marca de outro restaurante ou desativada não serve", async () => {
    const other = await prisma.restaurant.create({ data: { name: "Outro", billingPlan: "EXEMPT" } });
    const foreign = await prisma.store.create({ data: { restaurantId: other.id, name: "Alheia" } });
    const sale = { type: "VENDA" as const, amountCents: R(1), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro") };
    await expect(createMovement(env.operator, sessionId, { ...sale, storeId: foreign.id })).rejects.toThrow(/Marca não encontrada/);
    const old = await saveStore(env.admin, { name: "Marca antiga", active: false });
    await expect(createMovement(env.operator, sessionId, { ...sale, storeId: old.id })).rejects.toThrow(/desativada/);
  });

  it("grade de totais vai inteira para a marca escolhida", async () => {
    await createMovementsBatch(
      env.operator,
      sessionId,
      [{ type: "VENDA", amountCents: R(20), channelId: env.ch("Balcão"), paymentMethodId: env.pm("Cartão de débito"), storeId: feijoada }],
      "grade-marca",
    );
    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    const feij = b.evaluation.summary.byStore.find((s) => s.storeId === feijoada)!;
    expect(feij.byKind.DEBIT).toBe(R(20));
  });

  it("corrigir a marca de uma venda fica registrado com antes e depois", async () => {
    const m = await createMovement(env.operator, sessionId, { type: "VENDA", amountCents: R(15), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX"), storeId: feijoada });
    await updateMovement(env.operator, m.movement.id, { storeId: prato }, "Era do Prato e Folha");
    const adj = await prisma.adjustment.findFirst({ where: { entityId: m.movement.id, field: { contains: "Marca" } } });
    expect(adj).toMatchObject({ oldValue: "A Feijoada", newValue: "Prato e Folha", reason: "Era do Prato e Folha" });
  });

  it("uma conferência só, e a nota de fechamento traz o faturamento de cada marca", async () => {
    const b = await loadSessionBundle(prisma, env.restaurantId, sessionId);
    const s = b.evaluation.summary;
    // Feijoada: 100 dinheiro + 50 PIX + 20 débito = 170; Prato: 30 + 80 online - 10 estorno + 15 PIX = 115
    expect(s.revenueCents).toBe(R(285));
    expect(s.byStore.find((x) => x.storeId === feijoada)?.netCents).toBe(R(170));
    expect(s.byStore.find((x) => x.storeId === prato)?.netCents).toBe(R(115));
    expect(s.cash.expectedCents).toBe(R(100) + R(100) + R(30) - R(40));

    const values: Record<string, number> = {};
    for (const l of b.evaluation.lines) if (l.required) values[l.key] = l.expectedCents;
    await saveConference(env.operator, sessionId, values);
    const res = await closeSession(env.operator, sessionId, {});
    expect(res.status).toBe("CORRETO");

    const closing = await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId } });
    const snap = closing.snapshot as unknown as ShiftReportData;
    expect(snap.byStore?.map((x) => [x.name, x.revenueCents])).toEqual([["A Feijoada", R(170)], ["Prato e Folha", R(115)]]);
    const prat = snap.byStore!.find((x) => x.name === "Prato e Folha")!;
    expect(prat.byChannel.find((c) => c.channelName === "iFood")?.netCents).toBe(R(80));
    const html = renderShiftReport(snap);
    expect(html).toContain("Faturamento por marca");
    expect(html).toContain("Prato e Folha");
  });

  it("relatório do dia, período e planilha também separam por marca", async () => {
    const day = await buildDayReport(env.manager, DAY);
    expect(day.byStore?.map((x) => x.revenueCents)).toEqual([R(170), R(115)]);
    expect(renderDayReport(day)).toContain("Faturamento por marca");

    const period = await buildPeriodReport(env.manager, { from: DAY, to: DAY });
    expect(period.byStore.map((x) => x.name)).toEqual(["A Feijoada", "Prato e Folha"]);
    const scoped = await buildPeriodReport(env.manager, { from: DAY, to: DAY, channelId: env.ch("iFood") });
    expect(scoped.byStore).toEqual([]);

    const csv = await buildExport(env.manager, { dataset: "vendas", from: DAY, to: DAY });
    const [header, ...rows] = csv.csv.replace(/^﻿/, "").trim().split(/\r?\n/);
    expect(header.split(";").at(-1)).toBe("Marca");
    expect(rows.filter((r) => r.endsWith(";Prato e Folha"))).toHaveLength(3);
  });

  it("com uma marca ativa só, venda sem marca volta a ser aceita", async () => {
    await saveStore(env.admin, { id: prato, name: "Prato e Folha", active: false });
    const { session } = await openSession(env.operator, {
      registerId: env.registers[1].id, shiftId: env.morning.id, businessDate: DAY, openingFloatCents: 0, floatMode: "NEW_OPENING",
    });
    const r = await createMovement(env.operator, session.id, { type: "VENDA", amountCents: R(5), channelId: env.ch("Balcão"), paymentMethodId: env.pm("PIX") });
    expect(r.movement.storeId).toBeNull();
  });
});
