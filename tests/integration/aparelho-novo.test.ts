import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { FORGET_DEVICE_DAYS, handleLoginDevice, noteDevice } from "@/server/services/new-device";
import type { MailMessage } from "@/server/email/provider";

let env: Env;
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15";
const ANDROID = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Mobile Safari/537.36";

beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

function outbox() {
  const sent: MailMessage[] = [];
  const send = async (m: MailMessage) => {
    sent.push(m);
    return { messageId: "x" };
  };
  return { sent, send };
}

describe("aviso de entrada em aparelho novo", () => {
  it("primeiro aparelho só registra; o mesmo aparelho de novo não avisa", async () => {
    const box = outbox();
    expect(await handleLoginDevice({ userId: env.manager.userId, deviceKey: "aparelho-do-escritorio-1234", userAgent: MAC, ip: "189.10.20.30" }, "https://app.test", box.send)).toBe(false);
    expect(await handleLoginDevice({ userId: env.manager.userId, deviceKey: "aparelho-do-escritorio-1234", userAgent: MAC, ip: "189.10.20.31" }, "https://app.test", box.send)).toBe(false);
    expect(box.sent).toHaveLength(0);
    expect(await prisma.knownDevice.count({ where: { userId: env.manager.userId } })).toBe(1);
  });

  it("aparelho novo manda e-mail para o dono da conta, com aparelho, endereço mascarado e link", async () => {
    const box = outbox();
    const now = new Date("2026-10-11T17:05:00Z");
    expect(await handleLoginDevice({ userId: env.manager.userId, deviceKey: "celular-desconhecido-5678", userAgent: ANDROID, ip: "200.150.1.2" }, "https://app.test/", box.send, now)).toBe(true);
    expect(box.sent).toHaveLength(1);
    const m = box.sent[0];
    expect(m.to).toEqual([env.manager.email]);
    expect(m.text).toContain("Chrome no Celular Android");
    expect(m.text).toContain("200.150.x.x");
    expect(m.text).not.toContain("200.150.1.2");
    expect(m.text).toContain("11/10/2026");
    expect(m.text).toContain("https://app.test/conta");
    expect(m.text).toContain("verificação em duas etapas");
    const log = await prisma.auditLog.findFirst({ where: { action: "login.new_device", userId: env.manager.userId } });
    expect(log?.newValue).toMatchObject({ aparelho: "Chrome no Celular Android", endereco: "200.150.x.x", avisoEnviado: true });
  });

  it("cada pessoa tem a sua lista: o mesmo navegador é novo para outra conta", async () => {
    await noteDevice({ userId: env.operator.userId, deviceKey: "tablet-da-recepcao-0001", userAgent: ANDROID });
    expect(await noteDevice({ userId: env.operator.userId, deviceKey: "aparelho-do-escritorio-1234", userAgent: MAC })).toBe(true);
  });

  it("aparelho esquecido depois de muito tempo sem uso volta a avisar", async () => {
    const old = new Date(Date.now() - (FORGET_DEVICE_DAYS + 1) * 86_400_000);
    await prisma.knownDevice.updateMany({ where: { userId: env.manager.userId, label: "Safari no Mac" }, data: { lastSeenAt: old } });
    expect(await noteDevice({ userId: env.manager.userId, deviceKey: "celular-desconhecido-5678", userAgent: ANDROID })).toBe(false);
    expect(await noteDevice({ userId: env.manager.userId, deviceKey: "aparelho-do-escritorio-1234", userAgent: MAC })).toBe(true);
  });

  it("falha no envio não derruba o login e fica registrada", async () => {
    const failing = async () => {
      throw new Error("SMTP fora do ar");
    };
    expect(await handleLoginDevice({ userId: env.manager.userId, deviceKey: "terceiro-aparelho-9999", userAgent: MAC }, "https://app.test", failing)).toBe(true);
    const log = await prisma.auditLog.findFirst({ where: { action: "login.new_device", userId: env.manager.userId }, orderBy: { createdAt: "desc" } });
    expect(log?.newValue).toMatchObject({ avisoEnviado: false });
  });
});
