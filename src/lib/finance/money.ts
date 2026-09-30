import { FinanceError } from "./types";

/** Maior valor aceito em um único campo: R$ 20.000.000,00 (cabe em INT do PostgreSQL com folga). */
export const MAX_CENTS = 2_000_000_000;

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function assertInt(cents: number): void {
  if (!Number.isInteger(cents)) {
    throw new FinanceError(`Valor monetário precisa ser inteiro em centavos, recebido ${cents}`);
  }
}

/** 123456 -> "R$ 1.234,56"; -2000 -> "-R$ 20,00" */
export function formatBRL(cents: number): string {
  assertInt(cents);
  const abs = Math.abs(cents);
  // Intl usa espaço não separável; troca por espaço comum para CSV, e-mail e testes
  const text = brl.format(abs / 100).replace(/ /g, " ");
  return cents < 0 ? `-${text}` : text;
}

/** Com sinal explícito para diferenças: "+R$ 20,00", "-R$ 20,00", "R$ 0,00" */
export function formatSigned(cents: number): string {
  assertInt(cents);
  if (cents === 0) return formatBRL(0);
  return cents > 0 ? `+${formatBRL(cents)}` : formatBRL(cents);
}

/** Sem símbolo, para CSV: 123456 -> "1234,56" */
export function formatDecimalComma(cents: number): string {
  assertInt(cents);
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const reais = Math.floor(abs / 100);
  const c = String(abs % 100).padStart(2, "0");
  return `${sign}${reais},${c}`;
}

/**
 * Converte texto digitado em centavos. Aceita "1.234,56", "1234,56", "1234.56", "R$ 100", "100".
 * Retorna null se o texto não for um valor válido. Nunca usa ponto flutuante.
 */
export function parseMoney(input: string | null | undefined, opts: { allowNegative?: boolean } = {}): number | null {
  if (input == null) return null;
  let s = String(input).trim().replace(/R\$/gi, "").replace(/\s+/g, "");
  if (s === "") return null;
  let negative = false;
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }
  if (negative && !opts.allowNegative) return null;
  if (!/^[\d.,]+$/.test(s)) return null;

  let intPart: string;
  let decPart = "";
  if (s.includes(",")) {
    const lastComma = s.lastIndexOf(",");
    intPart = s.slice(0, lastComma);
    decPart = s.slice(lastComma + 1);
    if (intPart.includes(",")) return null;
    // pontos só podem ser separadores de milhar
    if (intPart.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(intPart)) return null;
    intPart = intPart.replace(/\./g, "");
  } else if (s.includes(".")) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      // "1.234" -> milhar, convenção brasileira
      intPart = s.replace(/\./g, "");
    } else {
      const parts = s.split(".");
      if (parts.length !== 2) return null;
      intPart = parts[0];
      decPart = parts[1];
    }
  } else {
    intPart = s;
  }
  if (intPart === "") intPart = "0";
  if (!/^\d+$/.test(intPart)) return null;
  if (decPart !== "" && !/^\d{1,2}$/.test(decPart)) return null;
  if (intPart.length > 10) return null;

  const cents = Number(intPart) * 100 + Number(decPart.padEnd(2, "0") || "0");
  if (!Number.isSafeInteger(cents) || cents > MAX_CENTS) return null;
  return negative ? -cents : cents;
}

/** Soma segura de inteiros. */
export function sum(values: number[]): number {
  let total = 0;
  for (const v of values) {
    assertInt(v);
    total += v;
  }
  return total;
}
