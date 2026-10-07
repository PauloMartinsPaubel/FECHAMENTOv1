import { describe, expect, it } from "vitest";
import { percentChange, previousWeek } from "@/server/services/weekly";

describe("resumo semanal: período e comparação", () => {
  it("semana anterior completa, de segunda a domingo, qualquer que seja o dia", () => {
    expect(previousWeek("2026-10-12")).toEqual({ from: "2026-10-05", to: "2026-10-11" }); // segunda
    expect(previousWeek("2026-10-07")).toEqual({ from: "2026-09-28", to: "2026-10-04" }); // quarta
    expect(previousWeek("2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04" }); // domingo
    expect(previousWeek("2027-01-04")).toEqual({ from: "2026-12-28", to: "2027-01-03" }); // virada de ano
  });
  it("variação em relação à semana anterior", () => {
    expect(percentChange(11200, 10000)).toBe("+12% sobre a semana anterior");
    expect(percentChange(9050, 10000)).toBe("-9,5% sobre a semana anterior");
    expect(percentChange(10000, 10000)).toBe("igual à semana anterior");
    expect(percentChange(5000, 0)).toBe("sem base de comparação");
  });
});
