import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { createMovement, registerCancellation } from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession } from "@/server/services/closing";
import { saveSettings } from "@/server/services/admin";
import { runWeeklySummaries, sendWeeklySummary } from "@/server/services/weekly";
import { GET } from "@/app/api/cron/resumo-semanal/route";

let env: Env;
let server: SMTPServer;
const inbox: ParsedMail[] = [];
const MONDAY = "2026-09-14"; // resumo da semana 07/09 a 13/09

beforeAll(async () => {
  env = await bootstrap();
  await new Promise<void>((resolve) => {
    server = new SMTPServer({ authOptional: true, disabledCommands: ["STARTTLS"], onData(stream, _s, cb) { simpleParser(stream).then((m) => { inbox.push(m); cb(); }); } });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  Object.assign(process.env, { EMAIL_PROVIDER: "smtp", SMTP_HOST: "127.0.0.1", SMTP_SECURE: "false", SMTP_PORT: String((server.server.address() as AddressInfo).port), APP_URL: "https://caixa.exemplo.com.br" });

  // semana anterior à do resumo (31/08 a 06/09): R$ 1.000 para comparar
  await closedDay(0, "2026-09-01", [{ ch: "Balcão", pm: "Dinheiro", c: 100000 }], 110000);
  // semana do resumo: manhã com R$ 300 em dinheiro + R$ 500 iFood online e falta de R$ 20; tarde com R$ 400 PIX, correta
  await closedDay(1, "2026-09-08", [{ ch: "Balcão", pm: "Dinheiro", c: 30000 }, { ch: "iFood", pm: "Pagamento online", c: 50000 }], 38000, "Faltou troco", { online: 50000 });
  await closedDay(2, "2026-09-09", [{ ch: "Balcão", pm: "PIX", c: 40000 }], 10000, undefined, { pix: 40000 }, env.evening);
  // caixa esquecido aberto na semana
  await openSession(env.manager, { registerId: env.registers[3].id, shiftId: env.morning.id, businessDate: "2026-09-12", openingFloatCents: 10000, floatMode: "NEW_OPENING" });
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

async function closedDay(
  register: number, date: string, sales: { ch: string; pm: string; c: number }[], cash: number, justification?: string,
  other: { online?: number; pix?: number } = {}, shift = env.morning,
) {
  const { session } = await openSession(env.manager, { registerId: env.registers[register].id, shiftId: shift.id, businessDate: date, openingFloatCents: 10000, floatMode: "NEW_OPENING" });
  for (const s of sales) await createMovement(env.manager, session.id, { type: "VENDA", amountCents: s.c, channelId: env.ch(s.ch), paymentMethodId: env.pm(s.pm) });
  if (register === 1) await registerCancellation(env.manager, session.id, { orderNumber: "77", channelId: env.ch("iFood"), amountCents: 4500, reason: "Cliente desistiu", employeeName: "Gerente" });
  const values: Record<string, number> = { cash };
  if (other.online) values[`pm:${env.pm("Pagamento online")}:ch:${env.ch("iFood")}`] = other.online;
  if (other.pix) values[`pm:${env.pm("PIX")}`] = other.pix;
  await saveConference(env.manager, session.id, values);
  await closeSession(env.manager, session.id, { justification });
}

const settings = (weeklyRecipients: string) =>
  saveSettings(env.admin, { defaultOpeningFloatCents: 10000, toleranceCents: 0, defaultFloatMode: "NEW_OPENING", closingRecipients: "", weeklyRecipients });

describe("resumo semanal", () => {
  it("desligado sem destinatários; o botão manual avisa o que falta", async () => {
    expect(await sendWeeklySummary(env.restaurantId, { today: MONDAY })).toMatchObject({ sent: false, reason: "off" });
    await expect(sendWeeklySummary(env.restaurantId, { today: MONDAY, manual: env.admin })).rejects.toThrow(/Resumo semanal: quem recebe/);
  });

  it("manda o resumo da semana anterior com os números certos", async () => {
    await settings("dono@exemplo.com");
    const r = await sendWeeklySummary(env.restaurantId, { today: MONDAY });
    expect(r).toEqual({ sent: true, to: ["dono@exemplo.com"], week: { from: "2026-09-07", to: "2026-09-13" } });
    const mail = inbox.at(-1)!;
    expect(mail.subject).toBe("Resumo semanal 07/09 a 13/09: faturamento R$ 1.200,00 (+20% sobre a semana anterior)");
    const t = mail.text!;
    expect(t).toContain("Dinheiro: R$ 300,00 (25%)");
    expect(t).toContain("PIX: R$ 400,00 (33%)");
    expect(t).toContain("Online (plataformas): R$ 500,00 (42%)");
    expect(t).toContain("iFood: R$ 500,00 (42%)");
    expect(t).toContain("Caixas corretos: 1");
    expect(t).toContain("Caixas com diferença: 1");
    expect(t).toMatch(/08\/09 Manhã · Caixa 2 \(.+\): Falta -R\$ 20,00\. Faltou troco/);
    expect(t).toContain("Pedidos cancelados: 1 (R$ 45,00, fora do faturamento)");
    expect(t).toContain("ATENÇÃO: CAIXAS QUE NÃO FORAM FECHADOS");
    expect(t).toContain("12/09 Manhã · Caixa 4: ainda aberto");
    expect(t).toContain("https://caixa.exemplo.com.br/relatorios?from=2026-09-07&to=2026-09-13");
    expect(t).not.toContain("—");
  });

  it("o agendamento manda uma vez por semana; o botão manual manda de novo quando pedirem", async () => {
    const before = inbox.length;
    const again = await runWeeklySummaries(MONDAY);
    expect(again).toEqual([{ restaurantId: env.restaurantId, outcome: expect.objectContaining({ sent: false, reason: "already" }) }]);
    expect(inbox.length).toBe(before);
    expect(await sendWeeklySummary(env.restaurantId, { today: MONDAY, manual: env.admin })).toMatchObject({ sent: true });
    expect(inbox.length).toBe(before + 1);
    await expect(sendWeeklySummary(env.restaurantId, { today: MONDAY, manual: env.manager })).rejects.toMatchObject({ code: "FORBIDDEN" });
    // semana seguinte: manda de novo
    expect((await runWeeklySummaries("2026-09-21"))[0].outcome).toMatchObject({ sent: true, week: { from: "2026-09-14" } });
  });

  it("a rota do agendamento só aceita a Vercel (CRON_SECRET)", async () => {
    const call = (auth?: string) => GET(new NextRequest("https://x/api/cron/resumo-semanal", { headers: auth ? { authorization: auth } : {} }));
    delete process.env.CRON_SECRET;
    expect((await call("Bearer qualquer")).status).toBe(503);
    process.env.CRON_SECRET = "segredo-de-teste";
    expect((await call()).status).toBe(401);
    expect((await call("Bearer errado")).status).toBe(401);
    const ok = await call("Bearer segredo-de-teste");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ results: [expect.objectContaining({ restaurantId: env.restaurantId })] });
  });
});
