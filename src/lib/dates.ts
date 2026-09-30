/** Datas de negócio trafegam como "YYYY-MM-DD". O banco guarda DATE (meia-noite UTC). */

export const APP_TIMEZONE = process.env.APP_TIMEZONE || "America/Sao_Paulo";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
  if (!value || !ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function toDbDate(iso: string): Date {
  if (!isIsoDate(iso)) throw new Error(`Data inválida: ${iso}`);
  return new Date(`${iso}T00:00:00.000Z`);
}

export function fromDbDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Data de hoje no fuso do restaurante. */
export function todayIso(now: Date = new Date(), timeZone: string = APP_TIMEZONE): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addDays(iso: string, days: number): string {
  const d = toDbDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return fromDbDate(d);
}

/** Segunda-feira da semana da data. */
export function startOfWeek(iso: string): string {
  const d = toDbDate(iso);
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(iso, -dow);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = toDbDate(startOfMonth(iso));
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(0);
  return fromDbDate(d);
}

/** "30/09/2026" */
export function formatDateBR(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateTimeBR(value: Date | string, timeZone: string = APP_TIMEZONE): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function formatTimeBR(value: Date | string, timeZone: string = APP_TIMEZONE): string {
  const d = typeof value === "string" ? new Date(value) : value;
  return new Intl.DateTimeFormat("pt-BR", { timeZone, hour: "2-digit", minute: "2-digit" }).format(d);
}

const WEEKDAYS = ["domingo", "segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado"];
export function weekdayBR(iso: string): string {
  return WEEKDAYS[toDbDate(iso).getUTCDay()];
}
