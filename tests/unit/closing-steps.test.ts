import { describe, expect, it } from "vitest";
import { closingSteps } from "@/lib/closing-steps";
import type { SessionEvaluation } from "@/lib/finance/evaluate";

function ev(o: { moves?: number; integrity?: string[]; pending?: string[]; justify?: boolean } = {}): SessionEvaluation {
  return {
    summary: { movementCount: o.moves ?? 3, integrityIssues: o.integrity ?? [] },
    lines: [{ key: "cash", fullLabel: "Dinheiro" }, { key: "pm:x", fullLabel: "PIX" }],
    divergence: { pendingKeys: o.pending ?? [], requiresJustification: o.justify ?? false },
    issues: o.integrity ?? [],
  } as unknown as SessionEvaluation;
}

describe("passos do fechamento", () => {
  it("sem lançamentos, o passo atual é Lançamentos", () => {
    const s = closingSteps(ev({ moves: 0, pending: ["cash"] }), "OPEN");
    expect(s.map((x) => x.state)).toEqual(["current", "todo", "todo"]);
  });
  it("com lançamentos e linha sem conferir, o atual é Conferência e diz o que falta", () => {
    const s = closingSteps(ev({ pending: ["pm:x"] }), "OPEN");
    expect(s.map((x) => x.state)).toEqual(["done", "current", "todo"]);
    expect(s[1].pending[0]).toBe("Falta conferir: PIX.");
  });
  it("tudo conferido, falta fechar; pede justificativa quando passa da tolerância", () => {
    const s = closingSteps(ev({ justify: true }), "OPEN");
    expect(s.map((x) => x.state)).toEqual(["done", "done", "current"]);
    expect(s[2].pending[0]).toMatch(/justificativa/);
  });
  it("caixa fechado tem todos os passos concluídos", () => {
    expect(closingSteps(ev({ pending: ["cash"] }), "CLOSED").every((x) => x.state === "done")).toBe(true);
  });
});
