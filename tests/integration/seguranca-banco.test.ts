import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";

afterAll(async () => { await prisma.$disconnect(); });

describe("segurança do banco", () => {
  it("toda tabela tem proteção de linha (RLS): a API automática do Supabase não lê nada", async () => {
    const rows = await prisma.$queryRaw<{ t: string; rls: boolean }[]>`SELECT tablename AS t, rowsecurity AS rls FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    const open = rows.filter((r) => !r.rls).map((r) => r.t);
    // tabela nova sem RLS? crie a migração com ALTER TABLE ... ENABLE ROW LEVEL SECURITY
    expect(open).toEqual([]);
    expect(rows.length).toBeGreaterThan(20);
  });
});
