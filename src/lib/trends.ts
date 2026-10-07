/**
 * Painel de tendência: agrupa os números por dia em semanas (segunda a domingo) ou meses,
 * com todos os períodos presentes (período sem caixa fechado aparece com zero, não some do gráfico).
 */
import { addDays, startOfMonth, startOfWeek } from "./dates";
import type { Headline } from "./finance";

export type Granularity = "semana" | "mes";

export interface TrendPeriod {
  key: string;
  /** rótulo curto do eixo: "06/10" ou "out/26" */
  label: string;
  /** rótulo completo para dica e tabela */
  longLabel: string;
  from: string;
  to: string;
  /** período que ainda não terminou */
  partial: boolean;
  sessions: number;
  revenueCents: number;
  cashCents: number;
  cardsCents: number;
  pixCents: number;
  ticketsCents: number;
  onlineCents: number;
  otherCents: number;
  divergenceAbsCents: number;
  divergenceNetCents: number;
  cancellationsCents: number;
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

function addMonths(iso: string, n: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12;
  return `${yy}-${String(mm + 1).padStart(2, "0")}-01`;
}

/** Faixa de datas para os últimos `count` períodos, terminando no período de `today` (que pode estar pela metade). */
export function trendRange(granularity: Granularity, today: string, count = 12): { from: string; to: string } {
  if (granularity === "semana") return { from: addDays(startOfWeek(today), -7 * (count - 1)), to: today };
  return { from: addMonths(startOfMonth(today), -(count - 1)), to: today };
}

export function buildTrend(
  byDay: { key: string; sessionCount: number; headline: Headline }[],
  granularity: Granularity,
  today: string,
  count = 12,
): TrendPeriod[] {
  const { from } = trendRange(granularity, today, count);
  const periods: TrendPeriod[] = [];
  for (let i = 0; i < count; i++) {
    const start = granularity === "semana" ? addDays(from, 7 * i) : addMonths(from, i);
    const end = granularity === "semana" ? addDays(start, 6) : addDays(addMonths(start, 1), -1);
    const label = granularity === "semana" ? dm(start) : `${MONTHS[Number(start.slice(5, 7)) - 1]}/${start.slice(2, 4)}`;
    const longLabel =
      granularity === "semana"
        ? `Semana de ${dm(start)} a ${dm(end)}/${end.slice(0, 4)}`
        : `${MONTHS[Number(start.slice(5, 7)) - 1]} de ${start.slice(0, 4)}`;
    periods.push({
      key: start, label, longLabel, from: start, to: end, partial: end >= today,
      sessions: 0, revenueCents: 0, cashCents: 0, cardsCents: 0, pixCents: 0, ticketsCents: 0, onlineCents: 0, otherCents: 0,
      divergenceAbsCents: 0, divergenceNetCents: 0, cancellationsCents: 0,
    });
  }
  for (const d of byDay) {
    const p = periods.find((x) => d.key >= x.from && d.key <= x.to);
    if (!p) continue;
    const h = d.headline;
    p.sessions += d.sessionCount;
    p.revenueCents += h.revenueCents;
    p.cashCents += h.cashSalesCents;
    p.cardsCents += h.cardsCents;
    p.pixCents += h.pixCents;
    p.ticketsCents += h.ticketsCents;
    p.onlineCents += h.onlineCents;
    p.otherCents += h.otherCents;
    p.divergenceAbsCents += h.divergenceAbsCents;
    p.divergenceNetCents += h.divergenceNetCents;
    p.cancellationsCents += h.cancellationsCents;
  }
  return periods;
}

export interface TrendSummary {
  /** média dos períodos completos com algum caixa fechado */
  averageCents: number;
  best: TrendPeriod | null;
  /** último período completo x o anterior a ele (null sem base) */
  lastComplete: TrendPeriod | null;
  changePct: number | null;
  divergenceAbsCents: number;
}

export function summarizeTrend(periods: TrendPeriod[]): TrendSummary {
  const complete = periods.filter((p) => !p.partial);
  const withData = complete.filter((p) => p.sessions > 0);
  const averageCents = withData.length ? Math.round(withData.reduce((a, p) => a + p.revenueCents, 0) / withData.length) : 0;
  const best = withData.reduce<TrendPeriod | null>((a, p) => (!a || p.revenueCents > a.revenueCents ? p : a), null);
  const lastComplete = complete.at(-1) ?? null;
  const before = complete.at(-2);
  const changePct =
    lastComplete && before && before.revenueCents > 0 ? Math.round(((lastComplete.revenueCents - before.revenueCents) / before.revenueCents) * 1000) / 10 : null;
  return { averageCents, best, lastComplete, changePct, divergenceAbsCents: periods.reduce((a, p) => a + p.divergenceAbsCents, 0) };
}
