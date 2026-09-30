import { buildConferenceLines, CheckedValues, summarizeDivergence } from "./conference";
import { summarizeSession } from "./summary";
import {
  Catalog,
  ConferenceLine,
  DivergenceSummary,
  SessionInput,
  SessionSummary,
} from "./types";

export interface SessionEvaluation {
  summary: SessionSummary;
  lines: ConferenceLine[];
  divergence: DivergenceSummary;
  /** problemas de integridade + cobertura da conferência; fechamento é bloqueado se não vazio */
  issues: string[];
}

/** Ponto de entrada único: dado o que está no banco, devolve tudo que a tela e o relatório mostram. */
export function evaluateSession(
  input: SessionInput,
  catalog: Catalog,
  checked: CheckedValues,
  toleranceCents: number,
): SessionEvaluation {
  const summary = summarizeSession(input);
  const { lines, issues: lineIssues } = buildConferenceLines(summary, catalog, checked);
  const divergence = summarizeDivergence(lines, {
    toleranceCents,
    movements: input.movements,
    cancellations: input.cancellations,
    floatCents: input.openingFloatCents,
  });
  return { summary, lines, divergence, issues: [...summary.integrityIssues, ...lineIssues] };
}
