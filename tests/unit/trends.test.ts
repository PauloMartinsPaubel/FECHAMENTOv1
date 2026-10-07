import { describe, expect, it } from "vitest";
import { emptyHeadline } from "@/lib/finance";
import { buildTrend, summarizeTrend, trendRange } from "@/lib/trends";

const day = (key: string, revenue: number, divAbs = 0, sessions = 1) => ({ key, sessionCount: sessions, headline: { ...emptyHeadline(), revenueCents: revenue, divergenceAbsCents: divAbs } });

describe("tendências", () => {
  it("12 semanas de segunda a domingo, terminando na semana atual", () => {
    expect(trendRange("semana", "2026-10-07")).toEqual({ from: "2026-07-20", to: "2026-10-07" });
    expect(trendRange("mes", "2026-10-07")).toEqual({ from: "2025-11-01", to: "2026-10-07" });
  });

  it("agrupa por semana, mantém semanas vazias e marca a atual como em andamento", () => {
    const t = buildTrend([day("2026-09-28", 10000), day("2026-10-04", 5000, 300), day("2026-10-06", 2000)], "semana", "2026-10-07");
    expect(t).toHaveLength(12);
    const last2 = t.slice(-2);
    expect(last2.map((p) => [p.label, p.revenueCents, p.divergenceAbsCents, p.sessions, p.partial])).toEqual([
      ["28/09", 15000, 300, 2, false],
      ["05/10", 2000, 0, 1, true],
    ]);
    expect(t[0].revenueCents).toBe(0);
  });

  it("agrupa por mês, com virada de ano", () => {
    const t = buildTrend([day("2025-12-31", 100), day("2026-01-01", 200), day("2026-10-07", 50)], "mes", "2026-10-07");
    expect(t.map((p) => p.label).slice(0, 3)).toEqual(["nov/25", "dez/25", "jan/26"]);
    expect(t[1].revenueCents).toBe(100);
    expect(t[2].revenueCents).toBe(200);
    expect(t.at(-1)).toMatchObject({ label: "out/26", partial: true, longLabel: "out de 2026" });
  });

  it("resumo ignora o período em andamento e os vazios", () => {
    const t = buildTrend([day("2026-09-21", 20000), day("2026-09-28", 25000), day("2026-10-06", 99999)], "semana", "2026-10-07");
    const s = summarizeTrend(t);
    expect(s.averageCents).toBe(22500);
    expect(s.best?.label).toBe("28/09");
    expect(s.lastComplete?.label).toBe("28/09");
    expect(s.changePct).toBe(25);
  });
});
