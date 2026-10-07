import type {
  CashBreakdown,
  CashCountLine,
  ClosingStatus,
  DivergenceSummary,
  PaymentKind,
} from "@/lib/finance";

/** Foto completa de um turno. É o que o fechamento grava e o que todo relatório lê. JSON puro. */
export interface ShiftReportData {
  version: 1;
  generatedAt: string;
  restaurantName: string;
  session: {
    id: string;
    businessDate: string;
    shiftName: string;
    shiftCode: string;
    registerName: string;
    responsibleName: string;
    openedAt: string;
    closedAt: string | null;
    closedByName: string | null;
    status: "OPEN" | "CLOSED" | "REOPENED" | "CORRECTED";
    floatMode: "NEW_OPENING" | "TRANSFER";
    transferredFromLabel: string | null;
    revision: number;
    reopenCount: number;
  };
  floatCents: number;
  /** vendas por forma de pagamento (tipo) */
  salesByKind: {
    kind: PaymentKind;
    label: string;
    grossCents: number;
    refundsCents: number;
    adjustmentCents: number;
    netCents: number;
  }[];
  totals: {
    grossSalesCents: number;
    refundsCents: number;
    revenueAdjustmentCents: number;
    /** FATURAMENTO. Nunca inclui o fundo. */
    revenueCents: number;
    /** FATURAMENTO + FUNDO */
    controlledCents: number;
    cardsCents: number;
    suppliesCents: number;
    withdrawalsCents: number;
    expensesTotalCents: number;
    cancellationsCents: number;
    cancellationsCount: number;
  };
  cash: CashBreakdown;
  /** contagem do dinheiro por cédula e moeda; ausente em fechamentos antigos, null quando só o total foi digitado */
  cashCount?: { lines: CashCountLine[]; totalCents: number } | null;
  conference: {
    key: string;
    group: PaymentKind;
    label: string;
    fullLabel: string;
    systemCents: number;
    expectedCents: number;
    checkedCents: number | null;
    differenceCents: number | null;
  }[];
  cardsConference: { systemCents: number; checkedCents: number; differenceCents: number };
  divergence: {
    netCents: number;
    absCents: number;
    status: ClosingStatus | null;
    toleranceCents: number;
    requiresJustification: boolean;
    byGroup: DivergenceSummary["byGroup"];
    origins: DivergenceSummary["origins"];
    hints: string[];
  };
  matrix: {
    channelName: string;
    totalCents: number;
    cells: { methodName: string; kind: PaymentKind; brandName: string | null; netCents: number }[];
  }[];
  ticketBrands: { name: string; netCents: number }[];
  cancellations: {
    orderNumber: string;
    channelName: string;
    methodName: string | null;
    amountCents: number;
    reason: string;
    employeeName: string;
    occurredAt: string;
    linkedToSale: boolean;
  }[];
  /** sangrias, suprimentos, despesas, estornos e ajustes, para o relatório listar um a um */
  movementLines: {
    type: string;
    amountCents: number;
    description: string | null;
    methodName: string | null;
    channelName: string | null;
    orderNumber: string | null;
    occurredAt: string;
    cashEffect: number;
    revenueEffect: number;
  }[];
  justification: string | null;
  notes: string | null;
  integrityIssues: string[];
}

/** Uma alteração registrada (valor anterior, novo, quem, quando, por quê). */
export interface CorrectionLine {
  at: string;
  userName: string;
  entity: string;
  field: string;
  oldValue: string | null;
  newValue: string | null;
  reason: string;
}
