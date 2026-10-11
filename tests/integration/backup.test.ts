import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env, resetDatabase } from "./setup";
import { BACKUP_TABLES, createBackup, isEncryptedBackup, readBackup, restoreBackup, runNightlyBackup } from "@/server/services/backup";
import { openSession } from "@/server/services/sessions";
import { createUnit } from "@/server/services/units";
import type { MailMessage } from "@/server/email/provider";

let env: Env;
beforeAll(async () => {
  env = await bootstrap();
  await openSession(env.admin, { registerId: env.register.id, shiftId: env.morning.id, businessDate: "2026-10-01", openingFloatCents: 10000, floatMode: "NEW_OPENING" });
  await createUnit(env.admin, { name: "Filial" });
});
afterAll(async () => {
  delete process.env.BACKUP_ENCRYPTION_KEY;
  delete process.env.OPS_ALERT_EMAIL;
  delete process.env.EMAIL_PROVIDER;
  await prisma.$disconnect();
});

describe("cópia de segurança", () => {
  it("cobre todas as tabelas do banco, menos sessões de login e erros", async () => {
    const rows = await prisma.$queryRaw<{ t: string }[]>`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    const all = rows.map((r) => r.t).sort();
    expect([...BACKUP_TABLES, "auth_sessions", "error_events", "password_resets", "site_events", "rate_limit_hits", "known_devices"].sort()).toEqual(all);
  });

  it("gera, apaga tudo e restaura com os mesmos dados", async () => {
    const { file, counts } = await createBackup();
    expect(counts.cash_sessions).toBe(1);
    expect(counts.memberships).toBe(1);
    expect(readBackup(file).tables.users.length).toBe(counts.users);
    const before = await prisma.cashMovement.findMany({ orderBy: { id: "asc" } });

    await expect(restoreBackup(file)).rejects.toThrow(/já tem dados/);
    await resetDatabase();
    const restored = await restoreBackup(file);
    expect(restored).toEqual(counts);
    expect(await prisma.cashMovement.findMany({ orderBy: { id: "asc" } })).toEqual(before);
    expect(await prisma.restaurant.count()).toBe(2);
  });

  it("rotina noturna manda o arquivo por e-mail", async () => {
    process.env.OPS_ALERT_EMAIL = "suporte@teste.local";
    process.env.EMAIL_PROVIDER = "smtp";
    const sent: MailMessage[] = [];
    const r = await runNightlyBackup(new Date("2026-10-09T06:00:00Z"), async (m) => { sent.push(m); return { messageId: "x" }; });
    expect(r.sent).toBe(true);
    expect(sent[0].attachments[0].filename).toBe("fechamento-backup-2026-10-09.json.gz");
    expect(Buffer.isBuffer(sent[0].attachments[0].content)).toBe(true);
  });

  it("com BACKUP_ENCRYPTION_KEY o anexo sai cifrado e só abre com a chave", async () => {
    const key = "frase-longa-de-teste-para-cifrar";
    const { file, counts, encrypted } = await createBackup(new Date(), key);
    expect(encrypted).toBe(true);
    expect(isEncryptedBackup(file)).toBe(true);
    // nada legível: nem o cabeçalho do gzip nem e-mails dos usuários
    expect(file.subarray(5, 7).equals(Buffer.from([0x1f, 0x8b]))).toBe(false);
    expect(file.includes(Buffer.from("admin@teste.local"))).toBe(false);
    expect(() => readBackup(file, null)).toThrow(/está cifrada/);
    expect(() => readBackup(file, "outra-frase-qualquer-1234")).toThrow(/não confere/);
    expect(readBackup(file, key).tables.users.length).toBe(counts.users);
    // mexer num byte do arquivo é percebido
    const tampered = Buffer.from(file);
    tampered[tampered.length - 1] ^= 1;
    expect(() => readBackup(tampered, key)).toThrow(/não confere ou o arquivo está danificado/);

    await resetDatabase();
    expect(await restoreBackup(file, key)).toEqual(counts);
  });

  it("rotina noturna usa a chave do servidor e avisa no e-mail", async () => {
    process.env.BACKUP_ENCRYPTION_KEY = "frase-longa-de-teste-para-cifrar";
    const sent: MailMessage[] = [];
    const r = await runNightlyBackup(new Date("2026-10-10T06:00:00Z"), async (m) => { sent.push(m); return { messageId: "x" }; });
    expect(r.sent).toBe(true);
    expect(sent[0].attachments[0].filename).toBe("fechamento-backup-2026-10-10.json.gz.cifrado");
    expect(sent[0].text).toContain("O anexo está cifrado");
    expect(readBackup(sent[0].attachments[0].content as Buffer).version).toBe(1);
  });
});
