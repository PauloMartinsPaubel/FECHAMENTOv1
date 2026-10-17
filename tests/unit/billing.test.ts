import { describe, expect, it } from "vitest";
import { cleanCpfCnpj, computeAccess, coveredUntil, nextMonthSameDay } from "@/lib/billing";

const T = "2026-10-08";
describe("acesso pela assinatura", () => {
  it("isento e cancelado", () => {
    expect(computeAccess({ plan: "EXEMPT", trialEndDate: null, payments: [], today: T }).level).toBe("full");
    expect(computeAccess({ plan: "CANCELED", trialEndDate: null, payments: [], today: T }).level).toBe("readonly");
  });
  it("cancelou: continua liberado até o fim do que pagou ou do teste, e só depois vira só leitura", () => {
    const canceled = (today: string, trialEndDate: string | null, payments: { status: string; dueDate: string }[]) => computeAccess({ plan: "CANCELED", trialEndDate, payments, today });
    // pagou a mensalidade que vence em 31/10 e ainda estava no teste até 30/10 (o caso do teste com o Asaas)
    const paid = [{ status: "RECEIVED_IN_CASH", dueDate: "2026-10-31" }];
    expect(canceled("2026-10-17", "2026-10-30", paid)).toMatchObject({ level: "warning", reason: "canceled", message: expect.stringContaining("até 29/11/2026") });
    expect(canceled("2026-11-29", "2026-10-30", paid).level).toBe("warning");
    expect(canceled("2026-11-30", "2026-10-30", paid).level).toBe("readonly");
    // só o teste grátis, cobrança em aberto não conta
    expect(canceled(T, "2026-10-20", [{ status: "PENDING", dueDate: "2026-10-21" }])).toMatchObject({ level: "warning", message: expect.stringContaining("até 20/10/2026") });
    expect(canceled(T, "2026-10-07", [{ status: "PENDING", dueDate: "2026-10-08" }]).level).toBe("readonly");
    // estornada não garante nada
    expect(canceled(T, null, [{ status: "REFUNDED", dueDate: "2026-10-01" }]).level).toBe("readonly");
  });
  it("ciclo mensal: mesmo dia no mês seguinte, e o último dia quando o dia não existe", () => {
    expect(nextMonthSameDay("2026-10-31")).toBe("2026-11-30");
    expect(nextMonthSameDay("2026-01-31")).toBe("2026-02-28");
    expect(nextMonthSameDay("2028-01-30")).toBe("2028-02-29");
    expect(nextMonthSameDay("2026-12-15")).toBe("2027-01-15");
    expect(coveredUntil("2026-10-30", [{ status: "CONFIRMED", dueDate: "2026-09-10" }, { status: "RECEIVED", dueDate: "2026-10-10" }])).toBe("2026-11-09");
    expect(coveredUntil(null, [])).toBeNull();
  });
  it("teste grátis: liberado, aviso nos últimos dias, só leitura depois", () => {
    expect(computeAccess({ plan: "TRIAL", trialEndDate: "2026-10-20", payments: [], today: T })).toMatchObject({ level: "full", message: "Teste grátis até 20/10/2026." });
    expect(computeAccess({ plan: "TRIAL", trialEndDate: "2026-10-10", payments: [], today: T })).toMatchObject({ level: "warning", message: "O teste grátis termina em 2 dias (10/10/2026)." });
    expect(computeAccess({ plan: "TRIAL", trialEndDate: T, payments: [], today: T })).toMatchObject({ level: "warning", reason: "trial_ending" });
    expect(computeAccess({ plan: "TRIAL", trialEndDate: "2026-10-07", payments: [], today: T })).toMatchObject({ level: "readonly", reason: "trial_ended" });
  });
  it("assinante: em dia, vencendo, carência de 7 dias e bloqueio; pagar libera", () => {
    const sub = (status: string, dueDate: string) => computeAccess({ plan: "SUBSCRIBED", trialEndDate: null, payments: [{ status, dueDate }], today: T });
    expect(sub("PENDING", "2026-10-20")).toMatchObject({ level: "full", message: "Próxima mensalidade em 20/10/2026." });
    expect(sub("PENDING", "2026-10-09")).toMatchObject({ level: "warning", reason: "due_soon", message: "A mensalidade vence em 1 dia (09/10/2026)." });
    expect(sub("OVERDUE", "2026-10-05")).toMatchObject({ level: "warning", reason: "grace" });
    expect(sub("OVERDUE", "2026-10-05").message).toContain("bloqueia em 4 dias");
    expect(sub("OVERDUE", "2026-10-01")).toMatchObject({ level: "warning", reason: "grace" }); // 7 dias: último dia
    expect(sub("OVERDUE", "2026-09-30")).toMatchObject({ level: "readonly", reason: "blocked" });
    expect(sub("RECEIVED", "2026-09-30")).toMatchObject({ level: "full", reason: "active" });
    expect(computeAccess({ plan: "SUBSCRIBED", trialEndDate: null, payments: [], today: T }).level).toBe("full");
  });
  it("valida CPF e CNPJ pelos dígitos", () => {
    expect(cleanCpfCnpj("529.982.247-25")).toBe("52998224725");
    expect(cleanCpfCnpj("529.982.247-24")).toBeNull();
    expect(cleanCpfCnpj("111.111.111-11")).toBeNull();
    expect(cleanCpfCnpj("11.222.333/0001-81")).toBe("11222333000181");
    expect(cleanCpfCnpj("11.222.333/0001-80")).toBeNull();
    expect(cleanCpfCnpj("123")).toBeNull();
  });
});
