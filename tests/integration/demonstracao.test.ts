import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { breakIntoDenominations, createDemoUnit, DEMO_UNIT_NAME, demoStatus } from "@/server/services/demo";
import { cashCountTotal } from "@/lib/finance/cash-count";

let env: Env;
beforeAll(async () => { env = await bootstrap(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("unidade de demonstração", () => {
  it("separa valores em notas e moedas que somam o total", () => {
    for (const v of [0, 1, 199, 20000, 123457, 98765]) expect(cashCountTotal(breakIntoDenominations(v))).toBe(v);
  });

  it("só a conta isenta cria; gera caixas fechados pelas regras e um aberto hoje", async () => {
    await prisma.restaurant.update({ where: { id: env.restaurantId }, data: { billingPlan: "TRIAL" } });
    await expect(createDemoUnit(env.admin, { days: 2 })).rejects.toThrow(/dono do sistema/);
    await prisma.restaurant.update({ where: { id: env.restaurantId }, data: { billingPlan: "EXEMPT" } });
    await expect(createDemoUnit(env.manager, { days: 2 })).rejects.toThrow(/permissão/);

    const t0 = Date.now();
    const r = await createDemoUnit(env.admin, { days: 3 });
    const ms = Date.now() - t0;
    expect(r.closedSessions).toBe(6);
    const demo = await prisma.restaurant.findUniqueOrThrow({ where: { id: r.restaurantId } });
    expect(demo.name).toBe(DEMO_UNIT_NAME);
    expect(demo.billingPlan).toBe("EXEMPT");
    const statuses = await prisma.cashSession.groupBy({ by: ["status"], where: { restaurantId: r.restaurantId }, _count: true });
    expect(Object.fromEntries(statuses.map((s) => [s.status, s._count]))).toEqual({ CLOSED: 6, OPEN: 1 });
    const closings = await prisma.cashClosing.findMany({ where: { restaurantId: r.restaurantId } });
    expect(closings.every((c) => c.revenueCents > 0)).toBe(true);
    expect(closings.every((c) => c.floatCents === 20000)).toBe(true);
    // nada vazou para o restaurante de verdade
    expect(await prisma.cashSession.count({ where: { restaurantId: env.restaurantId } })).toBe(0);
    await expect(createDemoUnit(env.admin, { days: 3 })).rejects.toThrow(/já tem a unidade/);
    console.log(`demo de 3 dias em ${ms} ms`);
  }, 60_000);

  it("geração interrompida continua de onde parou, sem duplicar", async () => {
    env = await bootstrap();
    await expect(createDemoUnit(env.admin, { days: 5, stopAfter: 4 })).rejects.toThrow(/interrompida/);
    const demo = await prisma.restaurant.findFirstOrThrow({ where: { name: DEMO_UNIT_NAME } });
    expect(await demoStatus(env.admin.userId, 5)).toBe("incomplete");
    expect(await prisma.cashSession.count({ where: { restaurantId: demo.id, status: "CLOSED" } })).toBe(4);
    const before = await prisma.cashMovement.count({ where: { restaurantId: demo.id } });
    const r = await createDemoUnit(env.admin, { days: 5 });
    expect(r.resumed).toBe(true);
    expect(r.restaurantId).toBe(demo.id);
    expect(await prisma.cashSession.count({ where: { restaurantId: demo.id, status: "CLOSED" } })).toBe(10);
    expect(await prisma.cashSession.count({ where: { restaurantId: demo.id, status: "OPEN" } })).toBe(1);
    expect(await prisma.cashMovement.count({ where: { restaurantId: demo.id } })).toBeGreaterThan(before);
    expect(await prisma.restaurant.count({ where: { name: DEMO_UNIT_NAME } })).toBe(1);
    expect(await demoStatus(env.admin.userId, 5)).toBe("ready");
  }, 60_000);

  it("três semanas sem erro (vendas fracas não geram sangria maior que a gaveta)", async () => {
    env = await bootstrap();
    const r = await createDemoUnit(env.admin, { days: 21 });
    expect(r.closedSessions).toBe(42);
    const closings = await prisma.cashClosing.findMany({ where: { restaurantId: r.restaurantId } });
    expect(closings.every((c) => c.cashExpectedCents >= 0)).toBe(true);
    const withDiff = closings.filter((c) => c.totalDiffCents !== 0).length;
    console.log(`fechamentos com diferença: ${withDiff} de ${closings.length}`);
  }, 120_000);
});
