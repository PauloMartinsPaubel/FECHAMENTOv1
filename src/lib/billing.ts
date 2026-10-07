/**
 * Regras de acesso da assinatura. Puro: recebe o plano, o fim do teste e as cobranças; devolve o que pode.
 *
 * - Isento: tudo liberado.
 * - Teste grátis: tudo liberado até o último dia; aviso nos 3 dias finais. Depois, só leitura.
 * - Assinante: em dia, liberado. Cobrança vencendo em até 3 dias: aviso. Atrasada: aviso por 7 dias
 *   (carência) e depois só leitura. Pagou, libera na hora.
 * - Cancelado: só leitura.
 * "Só leitura" = não abre caixa novo. Relatórios, histórico e o fechamento de caixa já aberto continuam.
 * Dados nunca são apagados por falta de pagamento.
 */
export type BillingPlanCode = "EXEMPT" | "TRIAL" | "SUBSCRIBED" | "CANCELED";

export const GRACE_DAYS = 7;
export const WARN_DAYS = 3;
export const TRIAL_DAYS = 14;

/** cobrança em aberto no Asaas (ainda não paga) */
const OPEN = new Set(["PENDING", "OVERDUE"]);
const PAID = new Set(["RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"]);
export const isPaidStatus = (s: string) => PAID.has(s);

export interface AccessInput {
  plan: BillingPlanCode;
  /** último dia do teste (aaaa-mm-dd, horário local) */
  trialEndDate: string | null;
  payments: { status: string; dueDate: string }[];
  today: string;
}

export interface AccessState {
  level: "full" | "warning" | "readonly";
  reason: "exempt" | "trial" | "trial_ending" | "trial_ended" | "active" | "due_soon" | "grace" | "blocked" | "canceled";
  message: string;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T00:00:00Z`) - Date.parse(`${fromIso}T00:00:00Z`)) / 86_400_000);
}

const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function computeAccess(input: AccessInput): AccessState {
  const { plan, today } = input;
  if (plan === "EXEMPT") return { level: "full", reason: "exempt", message: "Restaurante isento de assinatura." };
  if (plan === "CANCELED") return { level: "readonly", reason: "canceled", message: "Assinatura cancelada. Os dados continuam disponíveis, mas não é possível abrir caixa novo." };

  if (plan === "TRIAL") {
    if (!input.trialEndDate) return { level: "full", reason: "trial", message: "Teste grátis." };
    const left = daysBetween(today, input.trialEndDate);
    if (left < 0) return { level: "readonly", reason: "trial_ended", message: `O teste grátis terminou em ${br(input.trialEndDate)}. Assine para voltar a abrir caixas.` };
    if (left < WARN_DAYS) {
      return { level: "warning", reason: "trial_ending", message: left === 0 ? "O teste grátis termina hoje. Assine para não interromper o uso." : `O teste grátis termina em ${plural(left, "dia", "dias")} (${br(input.trialEndDate)}).` };
    }
    return { level: "full", reason: "trial", message: `Teste grátis até ${br(input.trialEndDate)}.` };
  }

  // SUBSCRIBED: olha a cobrança em aberto mais antiga
  const open = input.payments.filter((p) => OPEN.has(p.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  if (!open) return { level: "full", reason: "active", message: "Assinatura em dia." };
  const late = daysBetween(open.dueDate, today);
  if (late > GRACE_DAYS) return { level: "readonly", reason: "blocked", message: `Mensalidade vencida em ${br(open.dueDate)} e não paga. Abrir caixa fica bloqueado até o pagamento.` };
  if (late > 0) {
    const left = GRACE_DAYS - late;
    return { level: "warning", reason: "grace", message: `Mensalidade vencida em ${br(open.dueDate)}. Pague para não bloquear a abertura de caixa${left > 0 ? ` (bloqueia em ${plural(left, "dia", "dias")})` : " (bloqueia amanhã)"}.` };
  }
  if (-late < WARN_DAYS) return { level: "warning", reason: "due_soon", message: late === 0 ? "A mensalidade vence hoje." : `A mensalidade vence em ${plural(-late, "dia", "dias")} (${br(open.dueDate)}).` };
  return { level: "full", reason: "active", message: `Próxima mensalidade em ${br(open.dueDate)}.` };
}

/** Valida CPF (11 dígitos) ou CNPJ (14) pelos dígitos verificadores. Devolve só os números, ou null. */
export function cleanCpfCnpj(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return null;
    const calc = (len: number) => {
      let sum = 0;
      for (let i = 0; i < len; i++) sum += Number(d[i]) * (len + 1 - i);
      const r = (sum * 10) % 11;
      return r === 10 ? 0 : r;
    };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]) ? d : null;
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return null;
    const calc = (len: number) => {
      const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
      const sum = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
      const r = sum % 11;
      return r < 2 ? 0 : 11 - r;
    };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]) ? d : null;
  }
  return null;
}
