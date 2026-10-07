import type { SessionEvaluation } from "./finance/evaluate";

export type StepState = "done" | "current" | "todo";
export interface ClosingStep {
  key: "lancamentos" | "conferencia" | "fechamento";
  label: string;
  slug: string;
  state: StepState;
  /** o que falta para concluir esta etapa; vazio quando concluída */
  pending: string[];
}

/**
 * Passos do fechamento: lançamentos, conferência e fechamento.
 * Função pura: recebe a avaliação do caixa e diz o que já foi feito e o que falta, na ordem.
 */
export function closingSteps(ev: SessionEvaluation, sessionStatus: string): ClosingStep[] {
  const closed = sessionStatus === "CLOSED" || sessionStatus === "CORRECTED";
  const launchPending: string[] = [];
  if (ev.summary.movementCount === 0) launchPending.push("Nenhuma venda ou movimentação lançada.");
  launchPending.push(...ev.summary.integrityIssues);

  const confPending: string[] = [];
  const unchecked = ev.lines.filter((l) => ev.divergence.pendingKeys.includes(l.key)).map((l) => l.fullLabel);
  if (unchecked.length) confPending.push(`Falta conferir: ${unchecked.join(", ")}.`);
  confPending.push(...ev.issues.filter((i) => !ev.summary.integrityIssues.includes(i)));

  const closePending: string[] = [];
  if (!closed) {
    if (ev.divergence.requiresJustification) closePending.push("A diferença passa da tolerância: escreva a justificativa antes de fechar.");
    closePending.push("Fechar o caixa.");
  }

  const raw = [
    { key: "lancamentos" as const, label: "Lançamentos", slug: "", pending: closed ? [] : launchPending },
    { key: "conferencia" as const, label: "Conferência", slug: "/conferencia", pending: closed ? [] : confPending },
    { key: "fechamento" as const, label: "Fechamento", slug: "/fechamento", pending: closePending },
  ];
  let currentSet = false;
  return raw.map((s) => {
    let state: StepState = "done";
    if (s.pending.length) {
      state = currentSet ? "todo" : "current";
      currentSet = true;
    }
    return { ...s, state };
  });
}
