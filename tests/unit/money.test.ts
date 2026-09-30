import { describe, expect, it } from "vitest";
import { formatBRL, formatDecimalComma, formatSigned, parseMoney } from "@/lib/finance";

describe("parseMoney", () => {
  it.each([
    ["100", 10000],
    ["100,00", 10000],
    ["1.234,56", 123456],
    ["1234,56", 123456],
    ["1234.56", 123456],
    ["R$ 1.250,00", 125000],
    ["0,05", 5],
    ["0,5", 50],
    [",5", 50],
    ["1.234", 123400],
    ["12.5", 1250],
    ["  20  ", 2000],
  ])("%s -> %i centavos", (input, cents) => {
    expect(parseMoney(input)).toBe(cents);
  });

  it.each(["", "abc", "1,234,56", "1.2.3,4", "10,999", "-5", "1e3", "12,3x", "99999999999"])(
    "rejeita %j",
    (input) => {
      expect(parseMoney(input)).toBeNull();
    },
  );

  it("aceita negativo só quando pedido", () => {
    expect(parseMoney("-20,00")).toBeNull();
    expect(parseMoney("-20,00", { allowNegative: true })).toBe(-2000);
  });

  it("não perde centavo com valores clássicos de ponto flutuante", () => {
    expect(parseMoney("0,1")! + parseMoney("0,2")!).toBe(30);
    expect(parseMoney("19,99")).toBe(1999);
    expect(parseMoney("1.005,05")).toBe(100505);
  });
});

describe("formatação", () => {
  it("formatBRL", () => {
    expect(formatBRL(0)).toBe("R$ 0,00");
    expect(formatBRL(123456)).toBe("R$ 1.234,56");
    expect(formatBRL(-2000)).toBe("-R$ 20,00");
    expect(formatBRL(5)).toBe("R$ 0,05");
  });
  it("formatSigned", () => {
    expect(formatSigned(2000)).toBe("+R$ 20,00");
    expect(formatSigned(-2000)).toBe("-R$ 20,00");
    expect(formatSigned(0)).toBe("R$ 0,00");
  });
  it("formatDecimalComma", () => {
    expect(formatDecimalComma(123456)).toBe("1234,56");
    expect(formatDecimalComma(-5)).toBe("-0,05");
  });
  it("recusa valor não inteiro", () => {
    expect(() => formatBRL(10.5)).toThrow();
  });
});
