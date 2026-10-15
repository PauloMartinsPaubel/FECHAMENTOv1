import { checkMovementIntegrity } from "./classify";
import {
  CashBreakdown,
  KindTotals,
  MatrixCell,
  MovementRow,
  PAYMENT_KINDS,
  PaymentKind,
  SessionInput,
  SessionSummary,
  StoreTotals,
} from "./types";

function emptyKindTotals(): KindTotals {
  return { grossCents: 0, refundsCents: 0, adjustmentCents: 0, netCents: 0 };
}

function emptyKindCents(): Record<PaymentKind, number> {
  const out = {} as Record<PaymentKind, number>;
  for (const k of PAYMENT_KINDS) out[k] = 0;
  return out;
}

/** Junta o faturamento por marca de vários caixas (dia, período). */
export function mergeStoreTotals(lists: StoreTotals[][]): StoreTotals[] {
  const out = new Map<string, { storeId: string | null; netCents: number; byKind: Record<PaymentKind, number>; channels: Map<string, number> }>();
  for (const list of lists) {
    for (const st of list) {
      const key = st.storeId ?? "";
      const acc = out.get(key) ?? { storeId: st.storeId, netCents: 0, byKind: emptyKindCents(), channels: new Map<string, number>() };
      acc.netCents += st.netCents;
      for (const k of PAYMENT_KINDS) acc.byKind[k] += st.byKind[k];
      for (const c of st.byChannel) acc.channels.set(c.channelId, (acc.channels.get(c.channelId) ?? 0) + c.netCents);
      out.set(key, acc);
    }
  }
  return [...out.values()].map((st) => ({
    storeId: st.storeId,
    netCents: st.netCents,
    byKind: st.byKind,
    byChannel: [...st.channels.entries()].map(([channelId, netCents]) => ({ channelId, netCents })),
  }));
}

export function emptyByKind(): Record<PaymentKind, KindTotals> {
  const out = {} as Record<PaymentKind, KindTotals>;
  for (const k of PAYMENT_KINDS) out[k] = emptyKindTotals();
  return out;
}

/**
 * Calcula todos os totais de uma sessão de caixa a partir das movimentações.
 *
 * Só entram movimentações ACTIVE. FATURAMENTO nunca inclui o fundo.
 * O fundo entra apenas em cash.expectedCents e em controlledCents (que tem rótulo próprio).
 */
export function summarizeSession(input: SessionInput): SessionSummary {
  const floatCents = input.openingFloatCents;
  const issues: string[] = [];
  if (!Number.isInteger(floatCents) || floatCents < 0) {
    issues.push(`Fundo de abertura inválido (${floatCents}).`);
  }

  const byKind = emptyByKind();
  const cash: CashBreakdown = {
    floatCents,
    salesCents: 0,
    suppliesCents: 0,
    withdrawalsCents: 0,
    expensesCents: 0,
    refundsCents: 0,
    adjustmentsCents: 0,
    expectedCents: 0,
  };

  let grossSales = 0;
  let refunds = 0;
  let revenueAdjustment = 0;
  let revenue = 0;
  let supplies = 0;
  let withdrawals = 0;
  let expensesTotal = 0;
  let cashEffectTotal = 0;
  let movementCount = 0;

  const matrix = new Map<string, MatrixCell>();
  const channelNet = new Map<string, number>();
  const brandNet = new Map<string, number>();
  const stores = new Map<string, { storeId: string | null; netCents: number; byKind: Record<PaymentKind, number>; channels: Map<string, number> }>();
  let anyStore = false;

  const active: MovementRow[] = input.movements.filter((m) => m.status === "ACTIVE");
  for (const m of active) {
    issues.push(...checkMovementIntegrity(m));
    movementCount++;

    const signedRevenue = m.revenueEffect * m.amountCents;
    const signedCash = m.cashEffect * m.amountCents;
    revenue += signedRevenue;
    cashEffectTotal += signedCash;

    switch (m.type) {
      case "VENDA":
        grossSales += m.amountCents;
        if (m.cashEffect !== 0) cash.salesCents += m.amountCents;
        break;
      case "ESTORNO":
        refunds += m.amountCents;
        if (m.cashEffect !== 0) cash.refundsCents += m.amountCents;
        break;
      case "SUPRIMENTO":
        supplies += m.amountCents;
        cash.suppliesCents += m.amountCents;
        break;
      case "SANGRIA":
        withdrawals += m.amountCents;
        cash.withdrawalsCents += m.amountCents;
        break;
      case "DESPESA":
        expensesTotal += m.amountCents;
        if (m.cashEffect !== 0) cash.expensesCents += m.amountCents;
        break;
      case "AJUSTE":
        revenueAdjustment += signedRevenue;
        cash.adjustmentsCents += signedCash;
        break;
    }

    if (m.revenueEffect !== 0 && m.paymentKind) {
      const k = byKind[m.paymentKind];
      if (m.type === "VENDA") k.grossCents += m.amountCents;
      else if (m.type === "ESTORNO") k.refundsCents += m.amountCents;
      else k.adjustmentCents += signedRevenue;
      k.netCents += signedRevenue;

      if (m.channelId && m.paymentMethodId) {
        const key = `${m.channelId}|${m.paymentMethodId}|${m.ticketBrandId ?? ""}`;
        const cell = matrix.get(key) ?? {
          channelId: m.channelId,
          paymentMethodId: m.paymentMethodId,
          paymentKind: m.paymentKind,
          ticketBrandId: m.ticketBrandId,
          netCents: 0,
        };
        cell.netCents += signedRevenue;
        matrix.set(key, cell);
        channelNet.set(m.channelId, (channelNet.get(m.channelId) ?? 0) + signedRevenue);
      }
      if (m.ticketBrandId) {
        brandNet.set(m.ticketBrandId, (brandNet.get(m.ticketBrandId) ?? 0) + signedRevenue);
      }

      const storeId = m.storeId ?? null;
      if (storeId) anyStore = true;
      const key = storeId ?? "";
      const st = stores.get(key) ?? { storeId, netCents: 0, byKind: emptyKindCents(), channels: new Map<string, number>() };
      st.netCents += signedRevenue;
      st.byKind[m.paymentKind] += signedRevenue;
      if (m.channelId) st.channels.set(m.channelId, (st.channels.get(m.channelId) ?? 0) + signedRevenue);
      stores.set(key, st);
    }
  }

  cash.expectedCents = floatCents + cashEffectTotal;

  // Cancelamentos: registro separado. Nunca entram em faturamento.
  let cancellationsCents = 0;
  for (const c of input.cancellations) cancellationsCents += c.amountCents;

  // Invariantes: todas as visões do mesmo faturamento precisam fechar entre si.
  const kindSum = PAYMENT_KINDS.reduce((acc, k) => acc + byKind[k].netCents, 0);
  const matrixSum = [...matrix.values()].reduce((acc, c) => acc + c.netCents, 0);
  if (kindSum !== revenue) issues.push(`Soma por forma (${kindSum}) diferente do faturamento (${revenue}).`);
  if (matrixSum !== revenue) issues.push(`Soma da matriz canal x forma (${matrixSum}) diferente do faturamento (${revenue}).`);
  if (revenue !== grossSales - refunds + revenueAdjustment) {
    issues.push("Faturamento diferente de vendas - estornos +/- ajustes.");
  }
  // sem nenhuma marca nos lançamentos, a separação não existe (unidade com um restaurante só)
  const byStore: StoreTotals[] = anyStore
    ? [...stores.values()].map((st) => ({
        storeId: st.storeId,
        netCents: st.netCents,
        byKind: st.byKind,
        byChannel: [...st.channels.entries()].map(([channelId, netCents]) => ({ channelId, netCents })),
      }))
    : [];
  const storeSum = byStore.reduce((acc, st) => acc + st.netCents, 0);
  if (anyStore && storeSum !== revenue) issues.push(`Soma por marca (${storeSum}) diferente do faturamento (${revenue}).`);

  const credit = byKind.CREDIT.netCents;
  const debit = byKind.DEBIT.netCents;

  return {
    floatCents,
    grossSalesCents: grossSales,
    refundsCents: refunds,
    revenueAdjustmentCents: revenueAdjustment,
    revenueCents: revenue,
    controlledCents: revenue + floatCents,
    byKind,
    cards: { creditCents: credit, debitCents: debit, totalCents: credit + debit },
    cash,
    suppliesCents: supplies,
    withdrawalsCents: withdrawals,
    expensesTotalCents: expensesTotal,
    cancellationsCents,
    cancellationsCount: input.cancellations.length,
    matrix: [...matrix.values()],
    byChannel: [...channelNet.entries()].map(([channelId, netCents]) => ({ channelId, netCents })),
    byTicketBrand: [...brandNet.entries()].map(([ticketBrandId, netCents]) => ({ ticketBrandId, netCents })),
    byStore,
    movementCount,
    integrityIssues: issues,
  };
}
