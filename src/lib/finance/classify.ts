import {
  Effect,
  FinanceError,
  MovementRow,
  MovementType,
  PaymentKind,
} from "./types";

/** Quais dos dois saldos cada tipo de movimentação afeta. Fonte única da regra. */
export interface Effects {
  revenueEffect: Effect;
  cashEffect: Effect;
}

export interface AdjustmentSpec {
  /** +1 soma, -1 subtrai */
  direction: 1 | -1;
  affectsRevenue: boolean;
  affectsCash: boolean;
}

export interface ClassifyInput {
  type: MovementType;
  paymentKind: PaymentKind | null;
  channelId?: string | null;
  ticketBrandId?: string | null;
  adjustment?: AdjustmentSpec;
}

/**
 * Decide os efeitos de uma movimentação. Lança FinanceError se a combinação for inválida.
 *
 *   VENDA       faturamento +1 | físico +1 se dinheiro
 *   SUPRIMENTO  faturamento  0 | físico +1
 *   SANGRIA     faturamento  0 | físico -1
 *   DESPESA     faturamento  0 | físico -1 se paga em dinheiro
 *   ESTORNO     faturamento -1 | físico -1 se devolvido em dinheiro
 *   AJUSTE      conforme informado; físico só com dinheiro
 *
 * FUNDO DE ABERTURA não passa por aqui: vem da sessão (faturamento 0 | físico +1).
 * CANCELAMENTO não passa por aqui: é um registro próprio e não cria efeito (0 | 0).
 */
export function classifyMovement(input: ClassifyInput): Effects {
  const { type, paymentKind } = input;
  const isCash = paymentKind === "CASH";

  switch (type) {
    case "VENDA":
      requireRevenueShape(input);
      return { revenueEffect: 1, cashEffect: isCash ? 1 : 0 };
    case "ESTORNO":
      requireRevenueShape(input);
      return { revenueEffect: -1, cashEffect: isCash ? -1 : 0 };
    case "SUPRIMENTO":
      return { revenueEffect: 0, cashEffect: 1 };
    case "SANGRIA":
      return { revenueEffect: 0, cashEffect: -1 };
    case "DESPESA":
      if (!paymentKind) throw new FinanceError("Informe como a despesa foi paga.");
      return { revenueEffect: 0, cashEffect: isCash ? -1 : 0 };
    case "AJUSTE": {
      const adj = input.adjustment;
      if (!adj) throw new FinanceError("Ajuste exige direção e o que ele afeta.");
      if (!adj.affectsRevenue && !adj.affectsCash) {
        throw new FinanceError("Ajuste precisa afetar o faturamento, o saldo físico ou ambos.");
      }
      if (adj.affectsCash && !isCash) {
        throw new FinanceError("Ajuste no saldo físico só pode usar a forma de pagamento Dinheiro.");
      }
      if (adj.affectsRevenue) requireRevenueShape(input);
      return {
        revenueEffect: adj.affectsRevenue ? adj.direction : 0,
        cashEffect: adj.affectsCash ? adj.direction : 0,
      };
    }
    default: {
      const never: never = type;
      throw new FinanceError(`Tipo de movimentação desconhecido: ${String(never)}`);
    }
  }
}

function requireRevenueShape(input: ClassifyInput): void {
  if (!input.paymentKind) throw new FinanceError("Informe a forma de pagamento.");
  if (!input.channelId) throw new FinanceError("Informe o canal de venda.");
  if (input.paymentKind === "TICKET" && !input.ticketBrandId) {
    throw new FinanceError("Informe a bandeira do ticket.");
  }
  if (input.paymentKind !== "TICKET" && input.ticketBrandId) {
    throw new FinanceError("Bandeira de ticket só pode ser usada com a forma Tickets / Vales.");
  }
}

/** Checagem de uma linha já gravada: os efeitos guardados precisam bater com a regra. */
export function checkMovementIntegrity(row: MovementRow): string[] {
  const issues: string[] = [];
  const tag = `Movimentação ${row.id} (${row.type})`;

  if (!Number.isInteger(row.amountCents) || row.amountCents <= 0) {
    issues.push(`${tag}: valor inválido (${row.amountCents}).`);
  }
  const revenueOk = [-1, 0, 1].includes(row.revenueEffect);
  const cashOk = [-1, 0, 1].includes(row.cashEffect);
  if (!revenueOk || !cashOk) {
    issues.push(`${tag}: efeito fora de -1, 0 ou 1.`);
    return issues;
  }

  try {
    if (row.type === "AJUSTE") {
      const nonZero = [row.revenueEffect, row.cashEffect].filter((e) => e !== 0);
      if (nonZero.length === 0) {
        issues.push(`${tag}: ajuste sem efeito algum.`);
      } else if (nonZero.length === 2 && row.revenueEffect !== row.cashEffect) {
        issues.push(`${tag}: ajuste com direções opostas em faturamento e saldo físico.`);
      } else {
        classifyMovement({
          type: "AJUSTE",
          paymentKind: row.paymentKind,
          channelId: row.channelId,
          ticketBrandId: row.ticketBrandId,
          adjustment: {
            direction: nonZero[0] as 1 | -1,
            affectsRevenue: row.revenueEffect !== 0,
            affectsCash: row.cashEffect !== 0,
          },
        });
      }
    } else {
      const expected = classifyMovement({
        type: row.type,
        paymentKind: row.paymentKind,
        channelId: row.channelId,
        ticketBrandId: row.ticketBrandId,
      });
      if (expected.revenueEffect !== row.revenueEffect || expected.cashEffect !== row.cashEffect) {
        issues.push(
          `${tag}: efeitos gravados (${row.revenueEffect}/${row.cashEffect}) diferem da regra (${expected.revenueEffect}/${expected.cashEffect}).`,
        );
      }
    }
  } catch (err) {
    issues.push(`${tag}: ${(err as Error).message}`);
  }

  // Movimentos que entram na matriz precisam de canal, forma e (se ticket) bandeira
  if (row.revenueEffect !== 0) {
    if (!row.channelId) issues.push(`${tag}: falta o canal de venda.`);
    if (!row.paymentMethodId) issues.push(`${tag}: falta a forma de pagamento.`);
  }
  return issues;
}
