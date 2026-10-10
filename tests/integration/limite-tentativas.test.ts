import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetDatabase } from "./setup";
import { enforce, hit, LIMITS, purgeOldHits } from "@/server/services/rate-limit";
import { recordSiteEvent } from "@/server/services/site-stats";

beforeAll(async () => { await resetDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("limite de tentativas por endereço", () => {
  it("bloqueia depois do limite, por endereço e por tipo, e libera quando a janela passa", async () => {
    const t0 = new Date("2026-10-12T12:00:00Z");
    for (let i = 0; i < LIMITS["senha-pedido"].limit; i++) expect((await hit("senha-pedido", "1.2.3.4", t0)).allowed).toBe(true);
    const blocked = await hit("senha-pedido", "1.2.3.4", t0);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMin).toBe(60);
    expect((await hit("senha-pedido", "5.6.7.8", t0)).allowed).toBe(true);
    expect((await hit("cadastro", "1.2.3.4", t0)).allowed).toBe(true);
    expect((await hit("senha-pedido", "1.2.3.4", new Date(t0.getTime() + 61 * 60_000))).allowed).toBe(true);
  });

  it("não guarda o endereço, só um hash", async () => {
    const rows = await prisma.rateLimitHit.findMany({ take: 50 });
    expect(rows.every((r) => !r.keyHash.includes("1.2.3.4") && r.keyHash.length === 40)).toBe(true);
  });

  it("sem endereço não limita; enforce recusa com mensagem", async () => {
    expect((await hit("login", null)).allowed).toBe(true);
    for (let i = 0; i < LIMITS["duas-etapas"].limit; i++) await enforce("duas-etapas", "9.9.9.9");
    await expect(enforce("duas-etapas", "9.9.9.9")).rejects.toThrow(/Muitas tentativas/);
  });

  it("medição do site ignora quem recarrega sem parar", async () => {
    const ua = "Mozilla/5.0 (Linux; Android 14) Chrome/129.0 Mobile Safari/537.36";
    await recordSiteEvent("view", null, ua, "7.7.7.7");
    const before = await prisma.siteEvent.count();
    for (let i = 0; i < LIMITS.site.limit + 5; i++) await prisma.rateLimitHit.create({ data: { bucket: "site", keyHash: (await import("node:crypto")).createHash("sha256").update("site:7.7.7.7:fechamento-de-caixa").digest("hex").slice(0, 40) } });
    await recordSiteEvent("view", null, ua, "7.7.7.7");
    expect(await prisma.siteEvent.count()).toBe(before);
  });

  it("limpeza apaga tentativas antigas", async () => {
    await prisma.rateLimitHit.create({ data: { bucket: "login", keyHash: "velho", createdAt: new Date("2020-01-01") } });
    expect(await purgeOldHits()).toBeGreaterThanOrEqual(1);
  });
});
