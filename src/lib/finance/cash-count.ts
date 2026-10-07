/**
 * Contagem do dinheiro da gaveta por cédula e moeda.
 *
 * A contagem é opcional: quem preferir digita só o total. Quando é usada, o total do dinheiro conferido
 * passa a ser exatamente a soma da contagem (o servidor confere), e a contagem fica guardada no fechamento.
 * Chave = valor da peça em centavos, como texto ("10000" = nota de R$ 100). Valor = quantidade de peças.
 */
export type CashCount = Record<string, number>;

export interface Denomination {
  cents: number;
  label: string;
  kind: "nota" | "moeda";
}

export const CASH_DENOMINATIONS: readonly Denomination[] = [
  { cents: 20000, label: "R$ 200", kind: "nota" },
  { cents: 10000, label: "R$ 100", kind: "nota" },
  { cents: 5000, label: "R$ 50", kind: "nota" },
  { cents: 2000, label: "R$ 20", kind: "nota" },
  { cents: 1000, label: "R$ 10", kind: "nota" },
  { cents: 500, label: "R$ 5", kind: "nota" },
  { cents: 200, label: "R$ 2", kind: "nota" },
  { cents: 100, label: "R$ 1", kind: "moeda" },
  { cents: 50, label: "50 centavos", kind: "moeda" },
  { cents: 25, label: "25 centavos", kind: "moeda" },
  { cents: 10, label: "10 centavos", kind: "moeda" },
  { cents: 5, label: "5 centavos", kind: "moeda" },
  { cents: 1, label: "1 centavo", kind: "moeda" },
];

const KNOWN = new Set(CASH_DENOMINATIONS.map((d) => String(d.cents)));

/** Limite de peças por valor: bem acima de qualquer gaveta, só para barrar digitação absurda. */
export const MAX_PIECES = 100_000;

/**
 * Valida e limpa uma contagem vinda de fora (formulário, JSON do banco).
 * Lança erro com mensagem para a tela se houver valor desconhecido ou quantidade inválida.
 * Quantidades zero são descartadas; uma contagem sem nenhuma peça vale (gaveta vazia).
 */
export function normalizeCashCount(input: Record<string, unknown>): CashCount {
  const out: CashCount = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!KNOWN.has(key)) throw new Error(`Valor de cédula ou moeda desconhecido: ${key}.`);
    const qty = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : 0;
    if (!Number.isInteger(qty) || qty < 0 || qty > MAX_PIECES) {
      const d = CASH_DENOMINATIONS.find((x) => String(x.cents) === key)!;
      throw new Error(`Quantidade inválida em ${d.label}: use um número inteiro de 0 a ${MAX_PIECES}.`);
    }
    if (qty > 0) out[key] = qty;
  }
  return out;
}

export function cashCountTotal(count: CashCount): number {
  let total = 0;
  for (const [key, qty] of Object.entries(count)) total += Number(key) * qty;
  return total;
}

export interface CashCountLine {
  cents: number;
  label: string;
  kind: "nota" | "moeda";
  quantity: number;
  totalCents: number;
}

/** Linhas para relatório, da maior peça para a menor, só as que têm quantidade. */
export function describeCashCount(count: CashCount): CashCountLine[] {
  return CASH_DENOMINATIONS.filter((d) => (count[String(d.cents)] ?? 0) > 0).map((d) => {
    const quantity = count[String(d.cents)];
    return { cents: d.cents, label: d.label, kind: d.kind, quantity, totalCents: d.cents * quantity };
  });
}

export function sameCashCount(a: CashCount | null, b: CashCount | null): boolean {
  if (a === null || b === null) return a === b;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? 0) !== (b[k] ?? 0)) return false;
  return true;
}

/** "2 x R$ 100, 3 x R$ 20" para auditoria e textos curtos. */
export function cashCountText(count: CashCount): string {
  const lines = describeCashCount(count);
  return lines.length ? lines.map((l) => `${l.quantity} x ${l.label}`).join(", ") : "nenhuma cédula ou moeda";
}

/** Contagem guardada no banco (JSON) para uso seguro; qualquer coisa estranha vira "sem contagem". */
export function parseStoredCashCount(raw: unknown): CashCount | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  try {
    return normalizeCashCount(raw as Record<string, unknown>);
  } catch {
    return null;
  }
}
