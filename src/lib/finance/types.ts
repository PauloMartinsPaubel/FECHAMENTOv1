/**
 * Tipos do motor financeiro. Nenhum import de banco ou framework aqui:
 * o motor recebe dados já carregados e devolve números.
 *
 * Regra de ouro: todo valor é inteiro em centavos.
 */

export const PAYMENT_KINDS = ["CASH", "CREDIT", "DEBIT", "PIX", "TICKET", "ONLINE", "OTHER"] as const;
export type PaymentKind = (typeof PAYMENT_KINDS)[number];

export const MOVEMENT_TYPES = ["VENDA", "SUPRIMENTO", "SANGRIA", "DESPESA", "ESTORNO", "AJUSTE"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** ACTIVE conta nos cálculos. VOIDED (lançado por engano) e CANCELLED (pedido cancelado) ficam guardados e fora das somas. */
export type MovementStatus = "ACTIVE" | "VOIDED" | "CANCELLED";

export type Effect = -1 | 0 | 1;

export const KIND_LABEL: Record<PaymentKind, string> = {
  CASH: "Dinheiro",
  CREDIT: "Cartão de crédito",
  DEBIT: "Cartão de débito",
  PIX: "PIX",
  TICKET: "Tickets / Vales",
  ONLINE: "Pagamento online",
  OTHER: "Outros",
};

export interface MovementRow {
  id: string;
  type: MovementType;
  status: MovementStatus;
  /** sempre positivo; o sinal vem de revenueEffect/cashEffect */
  amountCents: number;
  revenueEffect: Effect;
  cashEffect: Effect;
  channelId: string | null;
  paymentMethodId: string | null;
  paymentKind: PaymentKind | null;
  ticketBrandId: string | null;
  orderNumber?: string | null;
  description?: string | null;
}

export interface CancellationRow {
  id: string;
  /** venda lançada que foi cancelada (null = pedido que nunca entrou como venda) */
  movementId: string | null;
  orderNumber: string | null;
  channelId: string | null;
  paymentMethodId: string | null;
  paymentKind: PaymentKind | null;
  amountCents: number;
}

export interface ChannelInfo {
  id: string;
  name: string;
  isPlatform: boolean;
  active?: boolean;
  sortOrder?: number;
}
export interface MethodInfo {
  id: string;
  name: string;
  kind: PaymentKind;
  active?: boolean;
  sortOrder?: number;
}
export interface BrandInfo {
  id: string;
  name: string;
  active?: boolean;
  sortOrder?: number;
}

export interface Catalog {
  channels: ChannelInfo[];
  methods: MethodInfo[];
  brands: BrandInfo[];
}

export interface SessionInput {
  openingFloatCents: number;
  movements: MovementRow[];
  cancellations: CancellationRow[];
}

export interface KindTotals {
  /** vendas brutas da forma */
  grossCents: number;
  /** estornos da forma (positivo) */
  refundsCents: number;
  /** ajustes de faturamento da forma (com sinal) */
  adjustmentCents: number;
  /** o que a forma contribui ao faturamento: gross - refunds + ajustes */
  netCents: number;
}

export interface CashBreakdown {
  floatCents: number;
  /** vendas em dinheiro (bruto) */
  salesCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  /** despesas pagas em dinheiro (as que tiram da gaveta) */
  expensesCents: number;
  /** estornos devolvidos em dinheiro */
  refundsCents: number;
  /** ajustes com efeito no saldo físico (com sinal) */
  adjustmentsCents: number;
  /** fundo + vendas + suprimentos - sangrias - despesas - estornos +/- ajustes */
  expectedCents: number;
}

export interface MatrixCell {
  channelId: string;
  paymentMethodId: string;
  paymentKind: PaymentKind;
  ticketBrandId: string | null;
  /** faturamento líquido da célula (vendas - estornos +/- ajustes) */
  netCents: number;
}

export interface SessionSummary {
  floatCents: number;
  grossSalesCents: number;
  refundsCents: number;
  revenueAdjustmentCents: number;
  /** FATURAMENTO. Nunca inclui o fundo. */
  revenueCents: number;
  /** FATURAMENTO + FUNDO. Rótulo próprio: "valores controlados". */
  controlledCents: number;
  byKind: Record<PaymentKind, KindTotals>;
  cards: { creditCents: number; debitCents: number; totalCents: number };
  cash: CashBreakdown;
  suppliesCents: number;
  withdrawalsCents: number;
  /** todas as despesas, pagas em dinheiro ou não */
  expensesTotalCents: number;
  cancellationsCents: number;
  cancellationsCount: number;
  matrix: MatrixCell[];
  byChannel: { channelId: string; netCents: number }[];
  byTicketBrand: { ticketBrandId: string; netCents: number }[];
  movementCount: number;
  /** vazio quando tudo está coerente. O fechamento é bloqueado se houver itens. */
  integrityIssues: string[];
}

export interface ConferenceLine {
  /** chave estável: cash | pm:<método> | pm:<método>:tb:<bandeira> | pm:<método>:ch:<canal> */
  key: string;
  group: PaymentKind;
  paymentMethodId: string | null;
  ticketBrandId: string | null;
  channelId: string | null;
  /** nome curto da linha: "Dinheiro", "Alelo", "iFood" */
  label: string;
  /** nome completo para relatório e CSV: "Tickets / Alelo", "Online / iFood" */
  fullLabel: string;
  /** valor registrado no sistema (faturamento líquido da linha) */
  systemCents: number;
  /** o que deveria existir: igual ao sistema, exceto dinheiro (inclui fundo e movimentos físicos) */
  expectedCents: number;
  /** valor digitado pelo operador; null = ainda não conferido */
  checkedCents: number | null;
  /** conferido - esperado; null enquanto não conferido */
  differenceCents: number | null;
  /** a linha tem valor no sistema e exige conferência para fechar */
  required: boolean;
}

export type ClosingStatus = "CORRETO" | "FALTA" | "SOBRA" | "MISTO";

export interface GroupDivergence {
  group: PaymentKind;
  label: string;
  systemCents: number;
  expectedCents: number;
  checkedCents: number;
  differenceCents: number;
}

export interface DivergenceSummary {
  /** soma das diferenças com sinal */
  netCents: number;
  /** soma dos módulos das diferenças (usada na tolerância) */
  absCents: number;
  /** null enquanto houver linha obrigatória sem conferência */
  status: ClosingStatus | null;
  pendingKeys: string[];
  toleranceCents: number;
  requiresJustification: boolean;
  byGroup: GroupDivergence[];
  /** linhas com diferença diferente de zero, já quebradas por origem */
  origins: { key: string; label: string; differenceCents: number }[];
  hints: string[];
}

export class FinanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FinanceError";
  }
}
