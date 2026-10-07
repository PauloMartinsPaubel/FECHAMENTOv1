import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { createMovement } from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession, reopenSession } from "@/server/services/closing";
import { loadSessionBundle } from "@/server/loaders";
import { buildShiftReportData } from "@/server/reports/shift-data";
import { renderShiftReport } from "@/lib/reports/html";
import type { ShiftReportData } from "@/lib/reports/types";

let env: Env;
let sessionId: string;

beforeAll(async () => {
  env = await bootstrap();
  const { session } = await openSession(env.manager, {
    registerId: env.registers[1].id, shiftId: env.morning.id, businessDate: "2026-09-01", openingFloatCents: 10000, floatMode: "NEW_OPENING",
  });
  sessionId = session.id;
  // R$ 100 de fundo + R$ 52,35 de venda em dinheiro = R$ 152,35 esperado
  await createMovement(env.manager, sessionId, { type: "VENDA", amountCents: 5235, orderNumber: "1", channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro") });
});
afterAll(async () => {
  await prisma.$disconnect();
});

const COUNT = { "10000": "1", "5000": "1", "200": "1", "25": "1", "10": "1" }; // 152,35

describe("conferência do dinheiro por cédula e moeda", () => {
  it("o dinheiro conferido tem de bater com a soma da contagem", async () => {
    await expect(saveConference(env.operator, sessionId, { cash: 15000 }, null, COUNT)).rejects.toThrow(/soma R\$ 152,35.*R\$ 150,00/);
    await expect(saveConference(env.operator, sessionId, { cash: 15235 }, null, { ...COUNT, "300": "1" })).rejects.toThrow(/desconhecido/);
    await expect(saveConference(env.operator, sessionId, { cash: 15235 }, null, { ...COUNT, "100": "2,5" })).rejects.toThrow(/R\$ 1:/);
    await expect(saveConference(env.operator, sessionId, {}, null, COUNT)).rejects.toThrow(/junto com o dinheiro/);
  });

  it("grava a contagem junto com o total e registra na auditoria", async () => {
    await saveConference(env.operator, sessionId, { cash: 15235 }, null, COUNT);
    const row = await prisma.closingConference.findFirstOrThrow({ where: { sessionId, lineKey: "cash" } });
    expect(row.checkedCents).toBe(15235);
    expect(row.breakdown).toEqual({ "10000": 1, "5000": 1, "200": 1, "25": 1, "10": 1 });
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "conference.save", sessionId }, orderBy: { createdAt: "desc" } });
    expect(log.newValue).toMatchObject({ "Contagem de cédulas e moedas": "1 x R$ 100, 1 x R$ 50, 1 x R$ 2, 1 x 25 centavos, 1 x 10 centavos" });
  });

  it("salvar sem mexer na contagem (undefined) mantém; desligar (null) apaga", async () => {
    await saveConference(env.operator, sessionId, { cash: 15235 });
    expect((await prisma.closingConference.findFirstOrThrow({ where: { sessionId, lineKey: "cash" } })).breakdown).not.toBeNull();
    await saveConference(env.operator, sessionId, { cash: 15235 }, null, null);
    expect((await prisma.closingConference.findFirstOrThrow({ where: { sessionId, lineKey: "cash" } })).breakdown).toBeNull();
    await saveConference(env.operator, sessionId, { cash: 15235 }, null, COUNT);
  });

  it("o fechamento congela a contagem e o relatório (tela, e-mail, impressão) mostra peça por peça", async () => {
    await closeSession(env.operator, sessionId, {});
    const closing = await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId } });
    const snap = closing.snapshot as unknown as ShiftReportData;
    expect(snap.cashCount).toEqual({
      totalCents: 15235,
      lines: [
        { cents: 10000, label: "R$ 100", kind: "nota", quantity: 1, totalCents: 10000 },
        { cents: 5000, label: "R$ 50", kind: "nota", quantity: 1, totalCents: 5000 },
        { cents: 200, label: "R$ 2", kind: "nota", quantity: 1, totalCents: 200 },
        { cents: 25, label: "25 centavos", kind: "moeda", quantity: 1, totalCents: 25 },
        { cents: 10, label: "10 centavos", kind: "moeda", quantity: 1, totalCents: 10 },
      ],
    });
    const html = renderShiftReport(snap);
    expect(html).toContain("Contagem do dinheiro por cédula e moeda");
    expect(html).toContain("1 x 25 centavos");
    expect(closing.cashDiffCents).toBe(0);
  });

  it("na correção, mudar a contagem exige motivo e fica no histórico de alterações", async () => {
    await reopenSession(env.manager, sessionId, "Recontagem do troco");
    const recount = { "10000": "1", "2000": "2", "1000": "1", "200": "1", "25": "1", "10": "1" }; // 152,35 em outras peças
    await expect(saveConference(env.manager, sessionId, { cash: 15235 }, null, recount)).rejects.toThrow(/motivo da correção/);
    await saveConference(env.manager, sessionId, { cash: 15235 }, "Notas de 50 eram duas de 20 e uma de 10", recount);
    const adj = await prisma.adjustment.findFirstOrThrow({ where: { sessionId, field: "Conferência: Contagem de cédulas e moedas" } });
    expect(adj.oldValue).toContain("1 x R$ 50");
    expect(adj.newValue).toContain("2 x R$ 20");
    const live = buildShiftReportData(await loadSessionBundle(prisma, env.restaurantId, sessionId));
    expect(live.cashCount?.lines.map((l) => l.quantity)).toEqual([1, 2, 1, 1, 1, 1]);
  });

  it("fechamento sem contagem continua igual: relatório não mostra o quadro", async () => {
    const { session } = await openSession(env.manager, {
      registerId: env.registers[2].id, shiftId: env.morning.id, businessDate: "2026-09-02", openingFloatCents: 10000, floatMode: "NEW_OPENING",
    });
    await saveConference(env.manager, session.id, { cash: 10000 });
    await closeSession(env.manager, session.id, {});
    const snap = (await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId: session.id } })).snapshot as unknown as ShiftReportData;
    expect(snap.cashCount).toBeNull();
    expect(renderShiftReport(snap)).not.toContain("Contagem do dinheiro");
  });
});
