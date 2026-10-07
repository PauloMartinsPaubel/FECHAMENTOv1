import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { createMovement, voidMovement } from "@/server/services/movements";
import { saleShortcuts } from "@/server/services/shortcuts";

let env: Env;
beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("atalhos de venda", () => {
  it("contam as vendas ativas dos últimos 30 dias de todos os caixas, sem anuladas", async () => {
    const catalog = {
      channels: (await prisma.salesChannel.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })).map((c) => ({ id: c.id, name: c.name })),
      methods: (await prisma.paymentMethod.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } })).map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
      brands: (await prisma.ticketBrand.findMany({ where: { active: true } })).map((b) => ({ id: b.id, name: b.name })),
    };
    const { session } = await openSession(env.manager, {
      registerId: env.registers[0].id, shiftId: env.morning.id, businessDate: "2026-10-01", openingFloatCents: 10000, floatMode: "NEW_OPENING",
    });
    const sale = (channel: string, method: string, amountCents = 1000) =>
      createMovement(env.manager, session.id, { type: "VENDA", amountCents, channelId: env.ch(channel), paymentMethodId: env.pm(method) });
    for (let i = 0; i < 3; i++) await sale("Balcão", "PIX");
    await sale("Balcão", "Dinheiro");
    await sale("Balcão", "Dinheiro");
    const voided = await sale("iFood", "Pagamento online");
    await voidMovement(env.manager, voided.movement.id, "Lançado errado");

    const r = await saleShortcuts(env.restaurantId, catalog, new Date());
    expect(r.filter((s) => s.uses > 0).map((s) => [s.label, s.uses])).toEqual([["Balcão · PIX", 3], ["Balcão · Dinheiro", 2]]);
    expect(r.filter((s) => s.uses === 0).map((s) => s.label)).not.toContain("iFood · Pagamento online");
    // 31 dias depois, nada conta mais: volta aos atalhos padrão
    const later = await saleShortcuts(env.restaurantId, catalog, new Date(Date.now() + 31 * 86_400_000));
    expect(later.every((s) => s.uses === 0)).toBe(true);
  });
});
