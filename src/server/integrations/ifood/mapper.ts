/**
 * Leitura do pedido do iFood (Merchant API, módulo Order v1.0).
 *
 * Eventos: conferidos com a página Endpoints do módulo Order (id, code, fullCode, orderId, createdAt).
 * O código pode vir curto ("CFM"), por extenso ("CONFIRMED") ou completo ("ORDER_CONFIRMED").
 *
 * Pedido: a página de endpoints mostra só id, status, orderType, category e total. Os campos de valores
 * abaixo ainda precisam ser conferidos com a página "Estrutura completa do pedido". Tudo o que depende
 * do formato do pedido está NESTE arquivo e nos testes dele.
 *
 * Campos usados:
 *   id, displayId, createdAt, orderType, status, merchant.id
 *   total.subTotal, total.deliveryFee, total.benefits, total.additionalFees, total.orderAmount
 *   payments.prepaid, payments.pending, payments.methods[].{value, method, type, card.brand}
 */
import type { PaymentKind } from "@/lib/finance";
import { decimalToCents, NormalizedOrder, NormalizedPayment, OrderStatus } from "../shared";

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/**
 * Código do evento (curto, por extenso ou com prefixo ORDER_) para o status do pedido.
 * Desconhecido = null (ignorado no status). Pedido de cancelamento e cancelamento recusado
 * (CANCELLATION_REQUESTED, CANCELLATION_REQUEST_FAILED) NÃO são cancelamento.
 */
export function statusFromEventCode(code: string | null | undefined): OrderStatus | null {
  switch ((code ?? "").trim().toUpperCase().replace(/^ORDER_/, "")) {
    case "PLC":
    case "PLACED":
      return "PLACED";
    case "CFM":
    case "CONFIRMED":
      return "CONFIRMED";
    case "RTP":
    case "READY_TO_PICKUP":
      return "READY";
    case "DSP":
    case "DISPATCHED":
      return "DISPATCHED";
    case "CON":
    case "CONCLUDED":
      return "CONCLUDED";
    case "CAN":
    case "CANCELLED":
      return "CANCELLED";
    default:
      return null;
  }
}

/** Para onde vai, na conferência do caixa, um pagamento recebido NA ENTREGA. */
export function cashKindFor(method: string, type: "ONLINE" | "OFFLINE"): PaymentKind {
  if (type === "ONLINE") return "ONLINE";
  switch (method.toUpperCase()) {
    case "CASH":
      return "CASH";
    case "CREDIT":
      return "CREDIT";
    case "DEBIT":
      return "DEBIT";
    case "PIX":
      return "PIX";
    case "MEAL_VOUCHER":
    case "FOOD_VOUCHER":
      return "TICKET";
    default:
      return "OTHER";
  }
}

export interface IfoodEvent {
  id: string;
  code: string;
  fullCode: string | null;
  /** status do pedido que este evento indica; null = evento que não muda o status */
  status: OrderStatus | null;
  orderId: string | null;
  merchantId: string | null;
  createdAt: Date | null;
  raw: unknown;
}

export function mapIfoodEvent(input: unknown): IfoodEvent | null {
  const e = obj(input);
  const id = str(e.id);
  const fullCode = str(e.fullCode);
  const code = str(e.code) ?? fullCode;
  if (!id || !code) return null;
  const created = str(e.createdAt);
  const d = created ? new Date(created) : null;
  return {
    id,
    code,
    fullCode,
    status: statusFromEventCode(code) ?? statusFromEventCode(fullCode),
    orderId: str(e.orderId),
    merchantId: str(e.merchantId),
    createdAt: d && !Number.isNaN(d.getTime()) ? d : null,
    raw: input,
  };
}

export function mapIfoodOrder(input: unknown): NormalizedOrder {
  const o = obj(input);
  const warnings: string[] = [];
  const externalId = str(o.id);
  if (!externalId) throw new Error("Pedido do iFood sem id.");
  const placedRaw = str(o.createdAt);
  const placedAt = placedRaw ? new Date(placedRaw) : new Date(NaN);
  if (Number.isNaN(placedAt.getTime())) throw new Error(`Pedido ${externalId} sem data de criação válida.`);

  const total = obj(o.total);
  const cents = (v: unknown, label: string) => {
    const c = decimalToCents(v);
    if (c === null) {
      warnings.push(`Campo ${label} ausente; considerado R$ 0,00.`);
      return 0;
    }
    if (c < 0) {
      warnings.push(`Campo ${label} negativo (${c}); considerado R$ 0,00.`);
      return 0;
    }
    return c;
  };
  const subtotalCents = cents(total.subTotal, "total.subTotal");
  const deliveryFeeCents = cents(total.deliveryFee ?? 0, "total.deliveryFee");
  const benefitsCents = cents(total.benefits ?? 0, "total.benefits");
  const additionalCents = cents(total.additionalFees ?? 0, "total.additionalFees");
  const orderAmount = decimalToCents(total.orderAmount);
  const totalCents = orderAmount ?? subtotalCents + deliveryFeeCents + additionalCents - benefitsCents;
  if (orderAmount === null) warnings.push("total.orderAmount ausente; total calculado pelas parcelas.");

  const pay = obj(o.payments);
  const methods = Array.isArray(pay.methods) ? pay.methods : [];
  const payments: NormalizedPayment[] = [];
  for (const m of methods) {
    const p = obj(m);
    const method = str(p.method) ?? "OTHER";
    const typeRaw = (str(p.type) ?? "").toUpperCase();
    const type: "ONLINE" | "OFFLINE" = typeRaw === "OFFLINE" ? "OFFLINE" : "ONLINE";
    if (typeRaw !== "ONLINE" && typeRaw !== "OFFLINE") warnings.push(`Pagamento ${method} sem tipo ONLINE/OFFLINE; tratado como ONLINE.`);
    const valueCents = decimalToCents(p.value);
    if (valueCents === null || valueCents < 0) {
      warnings.push(`Pagamento ${method} sem valor válido; ignorado.`);
      continue;
    }
    payments.push({ method, type, valueCents, brand: str(obj(p.card).brand), cashKind: cashKindFor(method, type) });
  }

  let onlineCents = payments.filter((p) => p.type === "ONLINE").reduce((a, p) => a + p.valueCents, 0);
  let offlineCents = payments.filter((p) => p.type === "OFFLINE").reduce((a, p) => a + p.valueCents, 0);

  const prepaid = decimalToCents(pay.prepaid);
  const pending = decimalToCents(pay.pending);
  if (payments.length === 0) {
    // sem detalhamento: usa o resumo pré-pago / a receber
    onlineCents = Math.max(0, prepaid ?? 0);
    offlineCents = Math.max(0, pending ?? 0);
    warnings.push("Pedido sem lista de pagamentos; usados os totais pré-pago e a receber.");
  } else if (prepaid !== null && pending !== null && prepaid + pending !== onlineCents + offlineCents) {
    warnings.push(
      `Soma dos pagamentos (${onlineCents + offlineCents}) difere de pré-pago + a receber (${prepaid + pending}).`,
    );
  }

  return {
    externalId,
    displayId: str(o.displayId),
    merchantId: str(obj(o.merchant).id),
    placedAt,
    orderType: str(o.orderType),
    reportedStatus: statusFromEventCode(str(o.status)),
    subtotalCents,
    deliveryFeeCents,
    benefitsCents,
    totalCents: Math.max(0, totalCents),
    onlineCents,
    offlineCents,
    payments,
    warnings,
  };
}
