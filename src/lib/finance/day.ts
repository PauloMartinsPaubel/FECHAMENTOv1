import { ClosingStatus, DivergenceSummary, PaymentKind, SessionSummary } from "./types";

/** Números principais de uma sessão (ou de um conjunto delas). Todos em centavos. */
export interface Headline {
  revenueCents: number;
  cashSalesCents: number;
  creditCents: number;
  debitCents: number;
  cardsCents: number;
  pixCents: number;
  ticketsCents: number;
  onlineCents: number;
  otherCents: number;
  refundsCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  expensesCents: number;
  cancellationsCents: number;
  cancellationsCount: number;
  divergenceNetCents: number;
  divergenceAbsCents: number;
}

export function emptyHeadline(): Headline {
  return {
    revenueCents: 0,
    cashSalesCents: 0,
    creditCents: 0,
    debitCents: 0,
    cardsCents: 0,
    pixCents: 0,
    ticketsCents: 0,
    onlineCents: 0,
    otherCents: 0,
    refundsCents: 0,
    suppliesCents: 0,
    withdrawalsCents: 0,
    expensesCents: 0,
    cancellationsCents: 0,
    cancellationsCount: 0,
    divergenceNetCents: 0,
    divergenceAbsCents: 0,
  };
}

export function headlineOf(summary: SessionSummary, divergence?: Pick<DivergenceSummary, "netCents" | "absCents">): Headline {
  const k = summary.byKind;
  return {
    revenueCents: summary.revenueCents,
    cashSalesCents: k.CASH.netCents,
    creditCents: k.CREDIT.netCents,
    debitCents: k.DEBIT.netCents,
    cardsCents: k.CREDIT.netCents + k.DEBIT.netCents,
    pixCents: k.PIX.netCents,
    ticketsCents: k.TICKET.netCents,
    onlineCents: k.ONLINE.netCents,
    otherCents: k.OTHER.netCents,
    refundsCents: summary.refundsCents,
    suppliesCents: summary.suppliesCents,
    withdrawalsCents: summary.withdrawalsCents,
    expensesCents: summary.expensesTotalCents,
    cancellationsCents: summary.cancellationsCents,
    cancellationsCount: summary.cancellationsCount,
    divergenceNetCents: divergence?.netCents ?? 0,
    divergenceAbsCents: divergence?.absCents ?? 0,
  };
}

export function addHeadlines(a: Headline, b: Headline): Headline {
  const out = { ...a };
  for (const key of Object.keys(b) as (keyof Headline)[]) out[key] = a[key] + b[key];
  return out;
}

export function sumHeadlines(list: Headline[]): Headline {
  return list.reduce(addHeadlines, emptyHeadline());
}

export interface DaySessionInput {
  sessionId: string;
  shiftId: string;
  shiftName: string;
  shiftOrder: number;
  registerName: string;
  floatMode: "NEW_OPENING" | "TRANSFER";
  openingFloatCents: number;
  headline: Headline;
  status?: ClosingStatus | null;
}

export interface DayFloatLine {
  sessionId: string;
  shiftName: string;
  registerName: string;
  floatCents: number;
  mode: "NEW_OPENING" | "TRANSFER";
  /** false quando o fundo foi transferido do turno anterior e não é entrada nova */
  countsAsNewEntry: boolean;
}

export interface DayShiftBlock {
  shiftId: string;
  shiftName: string;
  shiftOrder: number;
  sessionCount: number;
  headline: Headline;
  newFloatCents: number;
  transferredFloatCents: number;
}

export interface DayConsolidation {
  shifts: DayShiftBlock[];
  total: Headline;
  floatLines: DayFloatLine[];
  /** soma só dos fundos de nova abertura. Fundo transferido não é somado de novo. */
  floatCents: number;
  transferredFloatCents: number;
  /** FATURAMENTO + FUNDO (nova abertura). Rótulo próprio. */
  controlledCents: number;
}

/**
 * Consolida um dia. Regras:
 * - faturamento é a soma dos turnos;
 * - fundo de nova abertura soma; fundo transferido aparece, mas não soma de novo.
 */
export function consolidateDay(sessions: DaySessionInput[]): DayConsolidation {
  const blocks = new Map<string, DayShiftBlock>();
  const floatLines: DayFloatLine[] = [];

  for (const s of [...sessions].sort((a, b) => a.shiftOrder - b.shiftOrder)) {
    const countsAsNewEntry = s.floatMode === "NEW_OPENING";
    floatLines.push({
      sessionId: s.sessionId,
      shiftName: s.shiftName,
      registerName: s.registerName,
      floatCents: s.openingFloatCents,
      mode: s.floatMode,
      countsAsNewEntry,
    });
    const block =
      blocks.get(s.shiftId) ??
      ({
        shiftId: s.shiftId,
        shiftName: s.shiftName,
        shiftOrder: s.shiftOrder,
        sessionCount: 0,
        headline: emptyHeadline(),
        newFloatCents: 0,
        transferredFloatCents: 0,
      } satisfies DayShiftBlock);
    block.sessionCount++;
    block.headline = addHeadlines(block.headline, s.headline);
    if (countsAsNewEntry) block.newFloatCents += s.openingFloatCents;
    else block.transferredFloatCents += s.openingFloatCents;
    blocks.set(s.shiftId, block);
  }

  const shifts = [...blocks.values()].sort((a, b) => a.shiftOrder - b.shiftOrder);
  const total = sumHeadlines(shifts.map((b) => b.headline));
  const floatCents = shifts.reduce((a, b) => a + b.newFloatCents, 0);
  const transferredFloatCents = shifts.reduce((a, b) => a + b.transferredFloatCents, 0);

  return {
    shifts,
    total,
    floatLines,
    floatCents,
    transferredFloatCents,
    controlledCents: total.revenueCents + floatCents,
  };
}

export const KIND_TO_HEADLINE: Record<PaymentKind, keyof Headline> = {
  CASH: "cashSalesCents",
  CREDIT: "creditCents",
  DEBIT: "debitCents",
  PIX: "pixCents",
  TICKET: "ticketsCents",
  ONLINE: "onlineCents",
  OTHER: "otherCents",
};
