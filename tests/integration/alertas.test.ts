import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import { SMTPServer } from "smtp-server";
import { simpleParser, type ParsedMail } from "mailparser";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { createMovement } from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession, reopenSession } from "@/server/services/closing";
import { saveSettings } from "@/server/services/admin";
import { alertThreshold, sendDivergenceAlert } from "@/server/services/alerts";

let env: Env;
let server: SMTPServer;
const inbox: ParsedMail[] = [];

beforeAll(async () => {
  env = await bootstrap();
  await new Promise<void>((resolve) => {
    server = new SMTPServer({
      authOptional: true, disabledCommands: ["STARTTLS"],
      onData(stream, _s, cb) { simpleParser(stream).then((m) => { inbox.push(m); cb(); }); },
    });
    server.listen(0, "127.0.0.1", () => resolve());
  });
  process.env.EMAIL_PROVIDER = "smtp";
  process.env.SMTP_HOST = "127.0.0.1";
  process.env.SMTP_SECURE = "false";
  process.env.SMTP_PORT = String((server.server.address() as AddressInfo).port);
  process.env.APP_URL = "https://caixa.exemplo.com.br";
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

const settings = (alertRecipients: string, alertThresholdCents: number | null, toleranceCents = 500) =>
  saveSettings(env.admin, {
    defaultOpeningFloatCents: 10000, toleranceCents, defaultFloatMode: "NEW_OPENING", closingRecipients: "", alertRecipients, alertThresholdCents,
  });

/** caixa com R$ 100 de fundo e R$ 50 em dinheiro; conta `counted` na gaveta e fecha */
async function closeWith(register: number, date: string, countedCents: number, justification?: string) {
  const { session } = await openSession(env.manager, {
    registerId: env.registers[register].id, shiftId: env.morning.id, businessDate: date, openingFloatCents: 10000, floatMode: "NEW_OPENING",
  });
  await createMovement(env.manager, session.id, { type: "VENDA", amountCents: 5000, channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro") });
  await saveConference(env.manager, session.id, { cash: countedCents });
  await closeSession(env.manager, session.id, { justification });
  return session.id;
}

describe("alerta de divergência", () => {
  it("limite: o configurado, ou a tolerância quando não há", () => {
    expect(alertThreshold({ toleranceCents: 500, alertThresholdCents: null })).toBe(500);
    expect(alertThreshold({ toleranceCents: 500, alertThresholdCents: 2000 })).toBe(2000);
    expect(alertThreshold({ toleranceCents: 500, alertThresholdCents: 0 })).toBe(0);
  });

  it("sem destinatários, o alerta fica desligado", async () => {
    await settings("", null);
    const id = await closeWith(1, "2026-08-01", 12000, "Faltou troco");
    expect(await sendDivergenceAlert(env.manager, id)).toEqual({ sent: false, reason: "off" });
  });

  it("dentro do limite não alerta; acima, manda um e-mail com origem e justificativa", async () => {
    await settings("dono@exemplo.com, gerente@exemplo.com", 2000);
    const small = await closeWith(2, "2026-08-02", 13900, "Diferença pequena no troco"); // falta R$ 11,00
    expect(await sendDivergenceAlert(env.manager, small)).toEqual({ sent: false, reason: "below" });

    const big = await closeWith(3, "2026-08-03", 11500, "Faltou dinheiro na gaveta"); // falta R$ 35,00
    expect(await sendDivergenceAlert(env.manager, big)).toEqual({ sent: true, to: ["dono@exemplo.com", "gerente@exemplo.com"] });
    const mail = inbox.at(-1)!;
    expect(mail.subject).toBe("Alerta: Caixa 4 · Manhã de 03/08/2026 fechou faltando R$ 35,00");
    expect(mail.text).toContain("FALTA DE CAIXA: R$ 35,00");
    expect(mail.text).toContain("Dinheiro: -R$ 35,00");
    expect(mail.text).toContain("Justificativa: Faltou dinheiro na gaveta");
    expect(mail.text).toContain("Limite do alerta: R$ 20,00");
    expect(mail.text).toMatch(/https:\/\/caixa\.exemplo\.com\.br\/historico\/[0-9a-f-]{36}/);
    expect(mail.text).not.toContain("—");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "alert.divergence.sent", sessionId: big } });
    expect(log.newValue).toMatchObject({ revision: 1, absDiff: "R$ 35,00" });

    // chamar de novo (ex.: dois cliques) não manda outro e-mail para a mesma revisão
    const before = inbox.length;
    expect(await sendDivergenceAlert(env.manager, big)).toEqual({ sent: false, reason: "already" });
    expect(inbox.length).toBe(before);

    // reabrir e fechar de novo ainda com diferença: novo alerta, marcado como corrigido
    await reopenSession(env.manager, big, "Recontar a gaveta");
    await saveConference(env.manager, big, { cash: 11000 }, "Recontagem achou menos");
    await closeSession(env.manager, big, { justification: "Faltou dinheiro na gaveta, recontado", correctionReason: "Recontagem" });
    expect(await sendDivergenceAlert(env.manager, big)).toMatchObject({ sent: true });
    expect(inbox.at(-1)!.subject).toBe("Alerta: Caixa 4 · Manhã de 03/08/2026 foi corrigido faltando R$ 40,00");
  });

  it("sobra também alerta, e sem limite próprio usa a tolerância", async () => {
    await settings("dono@exemplo.com", null, 500);
    const id = await closeWith(4, "2026-08-04", 15800, "Sobrou troco de cliente"); // sobra R$ 8,00 > tolerância R$ 5,00
    expect(await sendDivergenceAlert(env.manager, id)).toMatchObject({ sent: true });
    expect(inbox.at(-1)!.subject).toBe("Alerta: Caixa 5 · Manhã de 04/08/2026 fechou sobrando R$ 8,00");
  });

  it("falha no envio não derruba nada: fica registrada na auditoria", async () => {
    await settings("dono@exemplo.com", 0);
    const id = await closeWith(5, "2026-08-05", 14900, "Faltou R$ 1");
    const port = process.env.SMTP_PORT;
    process.env.SMTP_PORT = "1";
    const r = await sendDivergenceAlert(env.manager, id);
    process.env.SMTP_PORT = port;
    expect(r).toMatchObject({ sent: false, reason: "failed" });
    expect(await prisma.auditLog.count({ where: { action: "alert.divergence.failed", sessionId: id } })).toBe(1);
    // depois do problema resolvido, dá para mandar
    expect(await sendDivergenceAlert(env.manager, id)).toMatchObject({ sent: true });
  });

  it("configuração valida e-mails e limite", async () => {
    await expect(settings("isso-nao-e-email", null)).rejects.toThrow(/E-mail inválido/);
    await expect(settings("dono@exemplo.com", -1)).rejects.toThrow(/limite do alerta/);
    await expect(saveSettings(env.manager, {
      defaultOpeningFloatCents: 10000, toleranceCents: 0, defaultFloatMode: "NEW_OPENING", closingRecipients: "", alertRecipients: "x@y.com",
    })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
