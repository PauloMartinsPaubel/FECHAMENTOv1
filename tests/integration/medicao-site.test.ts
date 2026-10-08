import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { resetDatabase } from "./setup";
import { isBot, recordSiteEvent, siteStats, sourceFromReferrer } from "@/server/services/site-stats";

const CHROME = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
beforeAll(async () => { await resetDatabase(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("medição da página de apresentação", () => {
  it("ignora robôs e a prévia do WhatsApp", () => {
    expect(isBot(CHROME)).toBe(false);
    expect(isBot("WhatsApp/2.23.20.0 A")).toBe(true);
    expect(isBot("facebookexternalhit/1.1")).toBe(true);
    expect(isBot("Mozilla/5.0 (compatible; Googlebot/2.1)")).toBe(true);
    expect(isBot(null)).toBe(true);
  });

  it("guarda só o site de origem, sem o próprio site", () => {
    expect(sourceFromReferrer("https://l.instagram.com/?u=https%3A%2F%2Fx", "fechamento.app")).toBe("instagram.com");
    expect(sourceFromReferrer("https://www.google.com/search?q=caixa", "fechamento.app")).toBe("google.com");
    expect(sourceFromReferrer("https://fechamento.app/conheca", "fechamento.app")).toBeNull();
    expect(sourceFromReferrer("lixo", "x")).toBeNull();
  });

  it("conta visitas, cliques e taxa de contato por período", async () => {
    const now = new Date();
    for (let i = 0; i < 8; i++) await recordSiteEvent("view", i < 3 ? "instagram.com" : null, CHROME);
    await recordSiteEvent("view", null, "WhatsApp/2.23");
    await recordSiteEvent("whatsapp", "topo", CHROME);
    await recordSiteEvent("cadastro", "convite", CHROME);
    await prisma.siteEvent.create({ data: { kind: "view", createdAt: new Date(now.getTime() - 20 * 86_400_000) } });
    const week = await siteStats(7, now);
    const month = await siteStats(30, now);
    expect(week.views).toBe(8);
    expect(month.views).toBe(9);
    expect(week.whatsapp).toBe(1);
    expect(week.conversionPct).toBe(25);
    expect(week.topSources).toEqual([{ source: "instagram.com", views: 3 }]);
  });
});
