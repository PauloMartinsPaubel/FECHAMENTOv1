import { describe, expect, it } from "vitest";
import { evaluateSession, formatBRL } from "@/lib/finance";
import { catalog, mov, R } from "./helpers";

const evaluate = (
  float: number,
  movements: ReturnType<typeof mov>[],
  checked: Record<string, number>,
  tolerance = 0,
) => evaluateSession({ openingFloatCents: float, movements, cancellations: [] }, catalog, checked, tolerance);

describe("TESTE 1: fundo R$ 100, dinheiro R$ 900, sem sangria", () => {
  const ev = evaluate(R(100), [mov("VENDA", "CASH", R(900))], { cash: R(1000) });

  it("dinheiro esperado é R$ 1.000 (fundo somado)", () => {
    expect(ev.summary.cash.expectedCents).toBe(R(1000));
  });
  it("faturamento é R$ 900 e nunca R$ 1.000", () => {
    expect(ev.summary.revenueCents).toBe(R(900));
    expect(ev.summary.revenueCents).not.toBe(R(1000));
  });
  it("R$ 1.000 é apenas o total controlado, com o fundo separado", () => {
    expect(ev.summary.controlledCents).toBe(R(1000));
    expect(ev.summary.floatCents).toBe(R(100));
  });
  it("caixa correto, sem justificativa", () => {
    expect(ev.divergence.status).toBe("CORRETO");
    expect(ev.divergence.netCents).toBe(0);
    expect(ev.divergence.requiresJustification).toBe(false);
  });
});

describe("TESTE 2: fundo R$ 100, dinheiro R$ 900, sangria R$ 300", () => {
  const ev = evaluate(R(100), [mov("VENDA", "CASH", R(900)), mov("SANGRIA", null, R(300), { description: "Cofre" })], { cash: R(680) });

  it("esperado fisicamente R$ 700", () => {
    expect(ev.summary.cash.expectedCents).toBe(R(700));
  });
  it("a sangria não altera o faturamento", () => {
    expect(ev.summary.revenueCents).toBe(R(900));
  });
  it("contado R$ 680 dá FALTA de R$ 20", () => {
    const cash = ev.lines.find((l) => l.key === "cash")!;
    expect(cash.differenceCents).toBe(-R(20));
    expect(ev.divergence.status).toBe("FALTA");
    expect(ev.divergence.netCents).toBe(-R(20));
  });
});

describe("TESTE 3: crédito R$ 2.000 + débito R$ 1.000, máquinas R$ 2.950", () => {
  const movements = [mov("VENDA", "CREDIT", R(2000)), mov("VENDA", "DEBIT", R(1000))];

  it("total de cartões é R$ 3.000", () => {
    const ev = evaluate(R(100), movements, {});
    expect(ev.summary.cards.totalCents).toBe(R(3000));
  });
  it("divergência de cartão é -R$ 50 quando as máquinas somam R$ 2.950", () => {
    const ev = evaluate(R(100), movements, { cash: R(100), "pm:pm-credit": R(2000), "pm:pm-debit": R(950) });
    const credit = ev.lines.find((l) => l.key === "pm:pm-credit")!;
    const debit = ev.lines.find((l) => l.key === "pm:pm-debit")!;
    expect(credit.differenceCents! + debit.differenceCents!).toBe(-R(50));
    expect(ev.divergence.netCents).toBe(-R(50));
    expect(ev.divergence.origins.map((o) => o.label)).toEqual(["Cartão de débito"]);
  });
  it("o fundo não entra em cartão", () => {
    const ev = evaluate(R(100), movements, {});
    const cards = ev.lines.filter((l) => l.group === "CREDIT" || l.group === "DEBIT");
    expect(cards.reduce((a, l) => a + l.expectedCents, 0)).toBe(R(3000));
  });
});

describe("TESTE 4: Alelo R$ 200, VR R$ 300, Ticket R$ 150", () => {
  const movements = [
    mov("VENDA", "TICKET", R(200), { ticketBrandId: "tb-alelo" }),
    mov("VENDA", "TICKET", R(300), { ticketBrandId: "tb-vr" }),
    mov("VENDA", "TICKET", R(150), { ticketBrandId: "tb-ticket" }),
  ];
  const ev = evaluate(R(100), movements, {});

  it("total de tickets é R$ 650", () => {
    expect(ev.summary.byKind.TICKET.netCents).toBe(R(650));
  });
  it("cada bandeira aparece separada", () => {
    const get = (id: string) => ev.lines.find((l) => l.key === `pm:pm-ticket:tb:${id}`)!.systemCents;
    expect(get("tb-alelo")).toBe(R(200));
    expect(get("tb-vr")).toBe(R(300));
    expect(get("tb-ticket")).toBe(R(150));
    expect(get("tb-pluxee")).toBe(0);
  });
  it("as bandeiras decompõem o grupo, sem somar em dobro", () => {
    const sum = ev.lines.filter((l) => l.group === "TICKET").reduce((a, l) => a + l.systemCents, 0);
    expect(sum).toBe(R(650));
  });
});

describe("TESTE 5: dinheiro 900, crédito 2.000, débito 1.000, PIX 800, tickets 650, fundo 100", () => {
  const movements = [
    mov("VENDA", "CASH", R(900)),
    mov("VENDA", "CREDIT", R(2000)),
    mov("VENDA", "DEBIT", R(1000)),
    mov("VENDA", "PIX", R(800)),
    mov("VENDA", "TICKET", R(650)),
  ];
  const ev = evaluate(R(100), movements, {});

  it("FATURAMENTO = R$ 5.350", () => {
    expect(ev.summary.revenueCents).toBe(R(5350));
    expect(formatBRL(ev.summary.revenueCents)).toBe("R$ 5.350,00");
  });
  it("FUNDO = R$ 100 e nunca faturamento de R$ 5.450", () => {
    expect(ev.summary.floatCents).toBe(R(100));
    expect(ev.summary.revenueCents).not.toBe(R(5450));
  });
  it("VALORES CONTROLADOS = R$ 5.450 com rótulo próprio", () => {
    expect(ev.summary.controlledCents).toBe(R(5450));
  });
  it("dinheiro físico esperado é R$ 1.000, demais formas sem fundo", () => {
    expect(ev.summary.cash.expectedCents).toBe(R(1000));
    expect(ev.summary.byKind.CREDIT.netCents).toBe(R(2000));
    expect(ev.summary.byKind.PIX.netCents).toBe(R(800));
  });
  it("a soma das linhas de conferência (sistema) é o faturamento", () => {
    expect(ev.lines.reduce((a, l) => a + l.systemCents, 0)).toBe(R(5350));
    expect(ev.issues).toEqual([]);
  });
});
