import { formatDecimalComma } from "@/lib/finance";

/** Valor em centavos numa célula de CSV (sai como 1234,56). */
export interface MoneyCell {
  money: number | null;
}
export const moneyCell = (cents: number | null | undefined): MoneyCell => ({ money: cents ?? null });

export type CsvCell = string | number | null | undefined | MoneyCell;

const SEPARATOR = ";";

function isMoney(cell: CsvCell): cell is MoneyCell {
  return typeof cell === "object" && cell !== null && "money" in cell;
}

/**
 * Texto que começa com = + - @ vira fórmula no Excel. Prefixar com apóstrofo
 * evita que uma descrição digitada por alguém execute algo na planilha do gerente.
 */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

function cellText(cell: CsvCell): string {
  if (cell === null || cell === undefined) return "";
  if (isMoney(cell)) return cell.money === null ? "" : formatDecimalComma(cell.money);
  if (typeof cell === "number") return String(cell);
  return neutralizeFormula(cell);
}

function quote(text: string): string {
  return /[";\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** CSV para o Excel brasileiro: separador ponto e vírgula, decimal com vírgula, UTF-8 com BOM. */
export function toCsv(headers: string[], rows: CsvCell[][]): string {
  const lines = [headers, ...rows].map((r) => r.map((c) => quote(cellText(c))).join(SEPARATOR));
  return "﻿" + lines.join("\r\n") + "\r\n";
}
