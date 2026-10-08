import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env, resetDatabase } from "./setup";
import { BACKUP_TABLES, createBackup, readBackup, restoreBackup, runNightlyBackup } from "@/server/services/backup";
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
  delete process.env.OPS_ALERT_EMAIL;
  delete process.env.EMAIL_PROVIDER;
  await prisma.$disconnect();
});

describe("cópia de segurança", () => {
  it("cobre todas as tabelas do banco, menos sessões de login e erros", async () => {
    const rows = await prisma.$queryRaw<{ t: string }[]>`SELECT table_name AS t FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> '_prisma_migrations'`;
    const all = rows.map((r) => r.t).sort();
    expect([...BACKUP_TABLES, "auth_sessions", "error_events", "password_resets", "site_events"].sort()).toEqual(all);
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
});
