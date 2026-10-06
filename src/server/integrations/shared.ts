import { APP_TIMEZONE, addDays, todayIso } from "@/lib/dates";
import type { PaymentKind } from "@/lib/finance";

/**
 * Converte o valor que a plataforma manda (número com casas decimais, ou texto) em centavos inteiros.
 * Passa pelo texto com 2 casas para não herdar erro de ponto flutuante (19.99 * 100 = 1998.9999...).
 */
export function decimalToCents(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const [int, dec = ""] = Math.abs(n).toFixed(2).split(".");
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"));
  return n < 0 ? -cents : cents;
}

export type OrderStatus = "PLACED" | "CONFIRMED" | "READY" | "DISPATCHED" | "CONCLUDED" | "CANCELLED";

/** Quanto mais adiante no ciclo, maior. Cancelado vence tudo. */
export const STATUS_RANK: Record<OrderStatus, number> = {
  PLACED: 1,
  CONFIRMED: 2,
  READY: 3,
  DISPATCHED: 4,
  CONCLUDED: 5,
  CANCELLED: 9,
};

export function laterStatus(a: OrderStatus | null | undefined, b: OrderStatus | null | undefined): OrderStatus {
  if (!a) return b ?? "PLACED";
  if (!b) return a;
  return STATUS_RANK[b] > STATUS_RANK[a] ? b : a;
}

export interface NormalizedPayment {
  /** forma como a plataforma chama (CREDIT, CASH, MEAL_VOUCHER...) */
  method: string;
  /** ONLINE = pago no app; OFFLINE = recebido na entrega */
  type: "ONLINE" | "OFFLINE";
  valueCents: number;
  brand: string | null;
  /** onde esse dinheiro aparece na conferência do caixa */
  cashKind: PaymentKind;
}

export interface NormalizedOrder {
  externalId: string;
  displayId: string | null;
  merchantId: string | null;
  placedAt: Date;
  orderType: string | null;
  /** status que o próprio detalhe do pedido informa, quando informa */
  reportedStatus: OrderStatus | null;
  subtotalCents: number;
  deliveryFeeCents: number;
  benefitsCents: number;
  totalCents: number;
  onlineCents: number;
  offlineCents: number;
  payments: NormalizedPayment[];
  /** avisos de leitura (campo faltando, soma que não fecha). Não bloqueiam, mas aparecem na tela. */
  warnings: string[];
}

/** Hora local "HH:MM" e data local "YYYY-MM-DD" de um instante, no fuso do restaurante. */
export function localParts(at: Date, timeZone: string = APP_TIMEZONE): { date: string; time: string } {
  const date = todayIso(at, timeZone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(at);
  return { date, time: time === "24:00" ? "00:00" : time };
}

export interface ShiftWindow {
  id: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
}

/**
 * Em que dia de negócio e turno um pedido cai.
 * Pedido de madrugada, antes do início do primeiro turno, pertence ao último turno do dia anterior.
 */
export function assignShift(at: Date, shifts: ShiftWindow[], timeZone: string = APP_TIMEZONE): { businessDate: string; shiftId: string | null } {
  const { date, time } = localParts(at, timeZone);
  const ordered = [...shifts].sort((a, b) => a.sortOrder - b.sortOrder);
  if (ordered.length === 0) return { businessDate: date, shiftId: null };
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  if (time < first.startTime) return { businessDate: addDays(date, -1), shiftId: last.id };
  for (const s of ordered) {
    if (time >= s.startTime && time < s.endTime) return { businessDate: date, shiftId: s.id };
  }
  // depois do fim do último turno (ex.: 23:59) ou num buraco entre turnos: fica no turno anterior mais próximo
  const before = ordered.filter((s) => s.startTime <= time);
  return { businessDate: date, shiftId: (before[before.length - 1] ?? last).id };
}
