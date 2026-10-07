import { describe, expect, it } from "vitest";
import {
  CASH_DENOMINATIONS, cashCountText, cashCountTotal, describeCashCount, normalizeCashCount, parseStoredCashCount, sameCashCount,
} from "@/lib/finance";

describe("contagem de cédulas e moedas", () => {
  it("soma em centavos inteiros, sem erro de arredondamento", () => {
    // 3 x 100 + 1 x 50 + 7 x 0,25 + 3 x 0,10 + 1 x 0,05 = 352,10
    const c = normalizeCashCount({ "10000": 3, "5000": "1", "25": 7, "10": 3, "5": 1 });
    expect(cashCountTotal(c)).toBe(35210);
    expect(cashCountText(c)).toBe("3 x R$ 100, 1 x R$ 50, 7 x 25 centavos, 3 x 10 centavos, 1 x 5 centavos");
  });

  it("todas as cédulas e moedas do real, da maior para a menor", () => {
    expect(CASH_DENOMINATIONS.map((d) => d.cents)).toEqual([20000, 10000, 5000, 2000, 1000, 500, 200, 100, 50, 25, 10, 5, 1]);
    const one = normalizeCashCount(Object.fromEntries(CASH_DENOMINATIONS.map((d) => [String(d.cents), 1])));
    expect(cashCountTotal(one)).toBe(38891);
    expect(describeCashCount(one)[0]).toMatchObject({ label: "R$ 200", quantity: 1, totalCents: 20000 });
  });

  it("campos vazios e zero são descartados; gaveta vazia é uma contagem válida", () => {
    expect(normalizeCashCount({ "10000": "", "5000": 0, "200": "  " })).toEqual({});
    expect(cashCountTotal({})).toBe(0);
    expect(cashCountText({})).toBe("nenhuma cédula ou moeda");
  });

  it("recusa valor que não existe e quantidade quebrada, negativa ou absurda", () => {
    expect(() => normalizeCashCount({ "300": 1 })).toThrow(/desconhecido/);
    expect(() => normalizeCashCount({ "10000": 1.5 })).toThrow(/R\$ 100/);
    expect(() => normalizeCashCount({ "10000": -1 })).toThrow(/inteiro/);
    expect(() => normalizeCashCount({ "10000": "abc" })).toThrow(/inteiro/);
    expect(() => normalizeCashCount({ "1": 100001 })).toThrow(/100000/);
  });

  it("compara contagens ignorando zeros e lê com segurança o que vem do banco", () => {
    expect(sameCashCount({ "10000": 2 }, { "10000": 2, "5000": 0 })).toBe(true);
    expect(sameCashCount({ "10000": 2 }, { "5000": 4 })).toBe(false);
    expect(sameCashCount(null, {})).toBe(false);
    expect(sameCashCount(null, null)).toBe(true);
    expect(parseStoredCashCount({ "2000": 3 })).toEqual({ "2000": 3 });
    expect(parseStoredCashCount([1, 2])).toBeNull();
    expect(parseStoredCashCount({ x: 1 })).toBeNull();
    expect(parseStoredCashCount(null)).toBeNull();
  });
});
