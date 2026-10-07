import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetDatabase } from "./setup";
import { errorFingerprint, healthCheck, reportError } from "@/server/services/monitoring";
import type { MailMessage } from "@/server/email/provider";

const sent: MailMessage[] = [];
const send = async (m: MailMessage) => { sent.push(m); return { messageId: "x" }; };

beforeAll(async () => {
  await resetDatabase();
  process.env.OPS_ALERT_EMAIL = "suporte@teste.local";
  process.env.EMAIL_PROVIDER = "smtp";
});
beforeEach(() => { sent.length = 0; });
afterAll(async () => {
  delete process.env.OPS_ALERT_EMAIL;
  delete process.env.EMAIL_PROVIDER;
  await prisma.$disconnect();
});

describe("monitoramento de erros", () => {
  it("mesma mensagem com ids e números diferentes é o mesmo erro", () => {
    const a = errorFingerprint({ message: "Falhou caixa 3 id 0b7c6a1e-1111-4222-8333-444455556666", path: "/caixa/0b7c6a1e-1111-4222-8333-444455556666" });
    const b = errorFingerprint({ message: "Falhou caixa 7 id 9a9a9a9a-1111-4222-8333-444455556666", path: "/caixa/9a9a9a9a-1111-4222-8333-444455556666" });
    expect(a).toBe(b);
    expect(errorFingerprint({ message: "Outro erro" })).not.toBe(a);
  });

  it("agrupa, conta e avisa no máximo uma vez por hora", async () => {
    const t0 = new Date("2026-10-09T12:00:00Z");
    expect((await reportError({ message: "Banco caiu", path: "/caixa" }, t0, send)).notified).toBe(true);
    expect((await reportError({ message: "Banco caiu", path: "/caixa" }, new Date(t0.getTime() + 10 * 60_000), send)).notified).toBe(false);
    expect((await reportError({ message: "Banco caiu", path: "/caixa" }, new Date(t0.getTime() + 61 * 60_000), send)).notified).toBe(true);
    expect(sent).toHaveLength(2);
    expect(sent[0].to).toEqual(["suporte@teste.local"]);
    const e = await prisma.errorEvent.findFirstOrThrow({ where: { message: "Banco caiu" } });
    expect(e.count).toBe(3);
  });

  it("sem destinatário configurado só registra; falha no envio não derruba", async () => {
    delete process.env.OPS_ALERT_EMAIL;
    expect((await reportError({ message: "Sem aviso" }, new Date(), send)).notified).toBe(false);
    process.env.OPS_ALERT_EMAIL = "suporte@teste.local";
    const boom = async () => { throw new Error("smtp fora"); };
    await expect(reportError({ message: "Envio falha" }, new Date(), boom)).resolves.toEqual({ notified: false });
    expect(sent).toHaveLength(0);
  });

  it("health check confirma o banco", async () => {
    expect((await healthCheck()).ok).toBe(true);
  });
});
