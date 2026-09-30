import { describe, expect, it } from "vitest";
import {
  checkMovementIntegrity,
  classifyMovement,
  consolidateDay,
  evaluateSession,
  headlineOf,
  summarizeSession,
  FinanceError,
  CancellationRow,
} from "@/lib/finance";
import { catalog, mov, R } from "./helpers";

const ev = (
  float: number,
  movements: ReturnType<typeof mov>[],
  checked: Record<string, number> = {},
  tolerance = 0,
  cancellations: CancellationRow[] = [],
) => evaluateSession({ openingFloatCents: float, movements, cancellations }, catalog, checked, tolerance);

describe("classifyMovement: efeitos por tipo", () => {
  it("VENDA em dinheiro: faturamento +1 e físico +1", () => {
    expect(classifyMovement({ type: "VENDA", paymentKind: "CASH", channelId: "c" })).toEqual({ revenueEffect: 1, cashEffect: 1 });
  });
  it.each(["CREDIT", "DEBIT", "PIX", "ONLINE", "OTHER"] as const)("VENDA em %s não mexe na gaveta", (kind) => {
    expect(classifyMovement({ type: "VENDA", paymentKind: kind, channelId: "c" })).toEqual({ revenueEffect: 1, cashEffect: 0 });
  });
  it("SUPRIMENTO entra só na gaveta", () => {
    expect(classifyMovement({ type: "SUPRIMENTO", paymentKind: null })).toEqual({ revenueEffect: 0, cashEffect: 1 });
  });
  it("SANGRIA sai só da gaveta", () => {
    expect(classifyMovement({ type: "SANGRIA", paymentKind: null })).toEqual({ revenueEffect: 0, cashEffect: -1 });
  });
  it("DESPESA em dinheiro sai da gaveta, em PIX não", () => {
    expect(classifyMovement({ type: "DESPESA", paymentKind: "CASH" })).toEqual({ revenueEffect: 0, cashEffect: -1 });
    expect(classifyMovement({ type: "DESPESA", paymentKind: "PIX" })).toEqual({ revenueEffect: 0, cashEffect: 0 });
  });
  it("ESTORNO reduz faturamento; só reduz a gaveta se devolvido em dinheiro", () => {
    expect(classifyMovement({ type: "ESTORNO", paymentKind: "CASH", channelId: "c" })).toEqual({ revenueEffect: -1, cashEffect: -1 });
    expect(classifyMovement({ type: "ESTORNO", paymentKind: "CREDIT", channelId: "c" })).toEqual({ revenueEffect: -1, cashEffect: 0 });
  });
  it("AJUSTE respeita o que foi informado e exige dinheiro para afetar a gaveta", () => {
    expect(
      classifyMovement({ type: "AJUSTE", paymentKind: "CASH", channelId: "c", adjustment: { direction: -1, affectsRevenue: false, affectsCash: true } }),
    ).toEqual({ revenueEffect: 0, cashEffect: -1 });
    expect(() =>
      classifyMovement({ type: "AJUSTE", paymentKind: "PIX", channelId: "c", adjustment: { direction: 1, affectsRevenue: true, affectsCash: true } }),
    ).toThrow(FinanceError);
    expect(() =>
      classifyMovement({ type: "AJUSTE", paymentKind: "CASH", channelId: "c", adjustment: { direction: 1, affectsRevenue: false, affectsCash: false } }),
    ).toThrow(FinanceError);
  });
  it("exige canal, forma e bandeira quando afeta faturamento", () => {
    expect(() => classifyMovement({ type: "VENDA", paymentKind: null, channelId: "c" })).toThrow();
    expect(() => classifyMovement({ type: "VENDA", paymentKind: "PIX", channelId: null })).toThrow();
    expect(() => classifyMovement({ type: "VENDA", paymentKind: "TICKET", channelId: "c", ticketBrandId: null })).toThrow();
    expect(() => classifyMovement({ type: "VENDA", paymentKind: "PIX", channelId: "c", ticketBrandId: "tb-vr" })).toThrow();
  });
});

describe("conferência de dinheiro (seção 5)", () => {
  it("exemplo do pedido: fundo 100, vendas 1.250, sangria 300, esperado 1.050, contado 1.030, falta 20", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(1250)), mov("SANGRIA", null, R(300), { description: "x" })], { cash: R(1030) });
    expect(e.summary.cash.expectedCents).toBe(R(1050));
    expect(e.lines.find((l) => l.key === "cash")!.differenceCents).toBe(-R(20));
    expect(e.divergence.status).toBe("FALTA");
  });
  it("fórmula completa com suprimento, despesa e estorno em dinheiro", () => {
    const e = ev(R(100), [
      mov("VENDA", "CASH", R(850)),
      mov("SUPRIMENTO", null, R(50), { description: "troco" }),
      mov("SANGRIA", null, R(200), { description: "cofre" }),
      mov("DESPESA", "CASH", R(30), { description: "gelo" }),
      mov("ESTORNO", "CASH", R(20), { orderNumber: "1" }),
    ]);
    // 100 + 850 + 50 - 200 - 30 - 20
    expect(e.summary.cash.expectedCents).toBe(R(750));
    expect(e.summary.cash).toMatchObject({ salesCents: R(850), suppliesCents: R(50), withdrawalsCents: R(200), expensesCents: R(30), refundsCents: R(20) });
    expect(e.summary.revenueCents).toBe(R(830)); // 850 - 20 estorno
  });
  it("sobra de caixa", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(100))], { cash: R(215) });
    expect(e.lines.find((l) => l.key === "cash")!.differenceCents).toBe(R(15));
    expect(e.divergence.status).toBe("SOBRA");
  });
  it("despesa paga por PIX não tira dinheiro da gaveta", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(100)), mov("DESPESA", "PIX", R(40), { description: "fornecedor" })]);
    expect(e.summary.cash.expectedCents).toBe(R(200));
    expect(e.summary.expensesTotalCents).toBe(R(40));
    expect(e.summary.cash.expensesCents).toBe(0);
  });
  it("fundo zero e nenhuma venda: nada exige conferência", () => {
    const e = ev(0, []);
    expect(e.lines.every((l) => !l.required)).toBe(true);
    expect(e.divergence.status).toBe("CORRETO");
  });
});

describe("conferência de cartões, PIX e exemplo geral (seções 4 e 7)", () => {
  it("cartões: sistema 3.770 vs máquinas 3.750 dá -20", () => {
    const e = ev(R(100), [mov("VENDA", "CREDIT", R(2350)), mov("VENDA", "DEBIT", R(1420))], {
      cash: R(100),
      "pm:pm-credit": R(2350),
      "pm:pm-debit": R(1400),
    });
    expect(e.summary.cards.totalCents).toBe(R(3770));
    expect(e.divergence.netCents).toBe(-R(20));
    expect(e.divergence.origins).toEqual([{ key: "pm:pm-debit", label: "Cartão de débito", differenceCents: -R(20) }]);
  });

  it("tela de conferência geral do pedido: divergência total -R$ 20 só no débito", () => {
    const e = ev(
      R(100),
      [
        mov("VENDA", "CASH", R(1250)),
        mov("VENDA", "CREDIT", R(2350)),
        mov("VENDA", "DEBIT", R(1420)),
        mov("VENDA", "PIX", R(780)),
        mov("VENDA", "TICKET", R(900), { ticketBrandId: "tb-alelo" }),
      ],
      {
        cash: R(1350),
        "pm:pm-credit": R(2350),
        "pm:pm-debit": R(1400),
        "pm:pm-pix": R(780),
        "pm:pm-ticket:tb:tb-alelo": R(900),
        "pm:pm-ticket:tb:tb-vr": 0,
        "pm:pm-ticket:tb:tb-ticket": 0,
        "pm:pm-ticket:tb:tb-pluxee": 0,
      },
    );
    expect(e.summary.cash.expectedCents).toBe(R(1350));
    expect(e.divergence.netCents).toBe(-R(20));
    expect(e.divergence.origins).toHaveLength(1);
  });

  it("resumo do fechamento da seção 8: 7.300 de faturamento, 7.400 controlados", () => {
    const e = ev(R(100), [
      mov("VENDA", "CASH", R(1250)),
      mov("VENDA", "CREDIT", R(2350)),
      mov("VENDA", "DEBIT", R(1420)),
      mov("VENDA", "PIX", R(780)),
      mov("VENDA", "TICKET", R(900)),
      mov("VENDA", "ONLINE", R(600), { channelId: "ch-ifood" }),
    ]);
    expect(e.summary.revenueCents).toBe(R(7300));
    expect(e.summary.controlledCents).toBe(R(7400));
  });
});

describe("linhas pendentes e status", () => {
  it("sem conferência digitada o status é indefinido e as linhas ficam pendentes", () => {
    const e = ev(R(100), [mov("VENDA", "PIX", R(50))], {});
    expect(e.divergence.status).toBeNull();
    expect(e.divergence.pendingKeys).toEqual(expect.arrayContaining(["cash", "pm:pm-pix"]));
  });
  it("faltas e sobras que se anulam continuam aparecendo: status MISTO e divergência absoluta", () => {
    const e = ev(R(100), [mov("VENDA", "CREDIT", R(500)), mov("VENDA", "DEBIT", R(500))], {
      cash: R(100),
      "pm:pm-credit": R(450),
      "pm:pm-debit": R(550),
    });
    expect(e.divergence.netCents).toBe(0);
    expect(e.divergence.absCents).toBe(R(100));
    expect(e.divergence.status).toBe("MISTO");
    expect(e.divergence.requiresJustification).toBe(true);
    expect(e.divergence.hints.join(" ")).toContain("lançamento na forma de pagamento errada");
  });
  it("tolerância: dentro dela não exige justificativa, mas o status continua mostrando a diferença", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(100))], { cash: R(199) }, R(2));
    expect(e.divergence.absCents).toBe(R(1));
    expect(e.divergence.requiresJustification).toBe(false);
    expect(e.divergence.status).toBe("FALTA");
  });
  it("acima da tolerância exige justificativa", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(100))], { cash: R(190) }, R(2));
    expect(e.divergence.requiresJustification).toBe(true);
  });
  it("conferido em linha sem valor no sistema vira sobra", () => {
    const e = ev(R(100), [], { cash: R(100), "pm:pm-pix": R(10) });
    expect(e.divergence.origins).toEqual([{ key: "pm:pm-pix", label: "PIX", differenceCents: R(10) }]);
    expect(e.divergence.status).toBe("SOBRA");
  });
});

describe("análise de origem (seção 16)", () => {
  it("quebra -70 em dinheiro -20 e cartão -50", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(400)), mov("VENDA", "CREDIT", R(1000))], {
      cash: R(480),
      "pm:pm-credit": R(950),
    });
    expect(e.divergence.netCents).toBe(-R(70));
    const byGroup = Object.fromEntries(e.divergence.byGroup.map((g) => [g.group, g.differenceCents]));
    expect(byGroup.CASH).toBe(-R(20));
    expect(byGroup.CREDIT).toBe(-R(50));
    expect(byGroup.PIX ?? 0).toBe(0);
  });
  it("aponta o fundo quando a falta é exatamente o fundo", () => {
    const e = ev(R(100), [mov("VENDA", "CASH", R(500))], { cash: R(500) });
    expect(e.divergence.hints.join(" ")).toContain("igual ao fundo de abertura");
  });
  it("aponta sangria de mesmo valor", () => {
    // esperado 100 + 500 - 150 = 450; contado 600 => sobra de 150, igual à sangria
    const e = ev(R(100), [mov("VENDA", "CASH", R(500)), mov("SANGRIA", null, R(150), { description: "cofre" })], { cash: R(600) });
    expect(e.summary.cash.expectedCents).toBe(R(450));
    expect(e.divergence.netCents).toBe(R(150));
    expect(e.divergence.hints.join(" ")).toContain("sangria de R$ 150,00");
  });
  it("aponta pedido cancelado de mesmo valor em cartão", () => {
    const cancel: CancellationRow = {
      id: "c1", movementId: null, orderNumber: "1234", channelId: "ch-balcao",
      paymentMethodId: "pm-credit", paymentKind: "CREDIT", amountCents: R(80),
    };
    const e = ev(R(100), [mov("VENDA", "CREDIT", R(500))], { cash: R(100), "pm:pm-credit": R(420) }, 0, [cancel]);
    expect(e.divergence.hints.join(" ")).toContain("pedido cancelado 1234");
  });
});

describe("cancelamentos, anulações e estornos (seções 18 e 19)", () => {
  it("venda CANCELLED ou VOIDED não entra no faturamento nem na gaveta", () => {
    const e = ev(R(100), [
      mov("VENDA", "CASH", R(300)),
      mov("VENDA", "CASH", R(120), { status: "CANCELLED" }),
      mov("VENDA", "CASH", R(77), { status: "VOIDED" }),
    ]);
    expect(e.summary.revenueCents).toBe(R(300));
    expect(e.summary.cash.expectedCents).toBe(R(400));
  });
  it("cancelamentos aparecem separados e nunca aumentam o faturamento", () => {
    const cancel: CancellationRow = {
      id: "c1", movementId: "m-x", orderNumber: "55", channelId: "ch-balcao",
      paymentMethodId: "pm-pix", paymentKind: "PIX", amountCents: R(120),
    };
    const sem = summarizeSession({ openingFloatCents: R(100), movements: [mov("VENDA", "PIX", R(100))], cancellations: [] });
    const com = summarizeSession({ openingFloatCents: R(100), movements: [mov("VENDA", "PIX", R(100))], cancellations: [cancel] });
    expect(com.revenueCents).toBe(sem.revenueCents);
    expect(com.cancellationsCents).toBe(R(120));
    expect(com.cancellationsCount).toBe(1);
  });
  it("estorno em cartão reduz faturamento e o esperado do cartão, sem tocar na gaveta", () => {
    const e = ev(R(100), [mov("VENDA", "CREDIT", R(500)), mov("ESTORNO", "CREDIT", R(30), { orderNumber: "9" })]);
    expect(e.summary.revenueCents).toBe(R(470));
    expect(e.summary.byKind.CREDIT).toMatchObject({ grossCents: R(500), refundsCents: R(30), netCents: R(470) });
    expect(e.summary.cash.expectedCents).toBe(R(100));
    expect(e.lines.find((l) => l.key === "pm:pm-credit")!.expectedCents).toBe(R(470));
  });
  it("ajuste de faturamento e de gaveta", () => {
    const e = ev(R(100), [
      mov("VENDA", "CASH", R(100)),
      mov("AJUSTE", "CASH", R(10), { adjustment: { direction: -1, affectsRevenue: true, affectsCash: true } }),
    ]);
    expect(e.summary.revenueCents).toBe(R(90));
    expect(e.summary.cash.expectedCents).toBe(R(190));
    expect(e.summary.revenueAdjustmentCents).toBe(-R(10));
  });
});

describe("canais independentes (seções 9 e 10)", () => {
  const movements = [
    mov("VENDA", "CASH", R(500), { channelId: "ch-balcao" }),
    mov("VENDA", "PIX", R(300), { channelId: "ch-balcao" }),
    mov("VENDA", "ONLINE", R(1200), { channelId: "ch-ifood" }),
    mov("VENDA", "CASH", R(100), { channelId: "ch-ifood" }),
    mov("VENDA", "ONLINE", R(800), { channelId: "ch-99" }),
    mov("VENDA", "CASH", R(100), { channelId: "ch-99" }),
    mov("VENDA", "PIX", R(200), { channelId: "ch-tel" }),
    mov("VENDA", "CASH", R(300), { channelId: "ch-tel" }),
    mov("VENDA", "CREDIT", R(60), { channelId: "ch-ecl" }),
  ];
  const e = ev(R(100), movements);
  const byChannel = (id: string) => e.summary.byChannel.find((c) => c.channelId === id)?.netCents ?? 0;

  it("99Food não é somado na Eclética nem o contrário", () => {
    expect(byChannel("ch-99")).toBe(R(900));
    expect(byChannel("ch-ecl")).toBe(R(60));
    const eclMatrix = e.summary.matrix.filter((c) => c.channelId === "ch-ecl");
    expect(eclMatrix).toHaveLength(1);
    expect(eclMatrix[0].paymentKind).toBe("CREDIT");
  });
  it("soma por canal, por forma e da matriz é sempre o mesmo faturamento", () => {
    const total = movements.reduce((a, m) => a + m.amountCents, 0);
    expect(e.summary.revenueCents).toBe(total);
    expect(e.summary.byChannel.reduce((a, c) => a + c.netCents, 0)).toBe(total);
    expect(e.summary.matrix.reduce((a, c) => a + c.netCents, 0)).toBe(total);
    expect(e.issues).toEqual([]);
  });
  it("online é conferido por plataforma e cada plataforma tem a sua linha", () => {
    const ifood = e.lines.find((l) => l.key === "pm:pm-online:ch:ch-ifood")!;
    const n99 = e.lines.find((l) => l.key === "pm:pm-online:ch:ch-99")!;
    expect(ifood.systemCents).toBe(R(1200));
    expect(n99.systemCents).toBe(R(800));
    expect(ifood.fullLabel).toBe("Pagamento online / iFood");
  });
  it("dinheiro recebido pelo iFood entra no dinheiro físico, não na linha online", () => {
    expect(e.summary.byKind.CASH.netCents).toBe(R(500 + 100 + 100 + 300));
  });
});

describe("integridade", () => {
  it("efeitos gravados fora da regra são acusados e bloqueiam", () => {
    const bad = { ...mov("VENDA", "PIX", R(10)), cashEffect: 1 as const };
    expect(checkMovementIntegrity(bad).join(" ")).toContain("diferem da regra");
    const e = ev(R(100), [bad]);
    expect(e.issues.length).toBeGreaterThan(0);
  });
  it("venda sem canal é acusada", () => {
    const bad = { ...mov("VENDA", "PIX", R(10)), channelId: null };
    expect(checkMovementIntegrity(bad).length).toBeGreaterThan(0);
  });
  it("lançamento em bandeira fora do cadastro deixa a conferência sem cobertura e avisa", () => {
    const e = ev(R(100), [mov("VENDA", "TICKET", R(40), { ticketBrandId: "tb-fantasma" })]);
    expect(e.issues.join(" ")).toContain("não existem no cadastro");
  });
  it("valor não positivo é acusado", () => {
    const bad = { ...mov("VENDA", "PIX", R(10)), amountCents: 0 };
    expect(checkMovementIntegrity(bad).join(" ")).toContain("valor inválido");
  });
});

describe("consolidado do dia (seções 11 a 13)", () => {
  const session = (shiftId: string, order: number, mode: "NEW_OPENING" | "TRANSFER", float: number, revenue: number, name: string) => {
    const summary = summarizeSession({
      openingFloatCents: float,
      movements: [mov("VENDA", "CASH", revenue)],
      cancellations: [],
    });
    return {
      sessionId: `s-${shiftId}`, shiftId, shiftName: name, shiftOrder: order, registerName: "Caixa 1",
      floatMode: mode, openingFloatCents: float, headline: headlineOf(summary, { netCents: 0, absCents: 0 }),
    };
  };

  it("nova abertura: fundos dos dois turnos aparecem separados e somam", () => {
    const d = consolidateDay([
      session("tn", 2, "NEW_OPENING", R(100), R(900), "Tarde/Noite"),
      session("ma", 1, "NEW_OPENING", R(100), R(850), "Manhã"),
    ]);
    expect(d.shifts.map((s) => s.shiftName)).toEqual(["Manhã", "Tarde/Noite"]);
    expect(d.floatLines.map((f) => [f.shiftName, f.floatCents])).toEqual([["Manhã", R(100)], ["Tarde/Noite", R(100)]]);
    expect(d.floatCents).toBe(R(200));
    expect(d.total.revenueCents).toBe(R(1750));
    expect(d.controlledCents).toBe(R(1950));
  });
  it("transferência: o mesmo fundo não entra como entrada nova", () => {
    const d = consolidateDay([
      session("ma", 1, "NEW_OPENING", R(100), R(850), "Manhã"),
      session("tn", 2, "TRANSFER", R(100), R(900), "Tarde/Noite"),
    ]);
    expect(d.floatCents).toBe(R(100));
    expect(d.transferredFloatCents).toBe(R(100));
    expect(d.controlledCents).toBe(R(1850));
    expect(d.floatLines[1].countsAsNewEntry).toBe(false);
  });
  it("faturamento do dia nunca inclui o fundo", () => {
    const d = consolidateDay([session("ma", 1, "NEW_OPENING", R(100), R(850), "Manhã")]);
    expect(d.total.revenueCents).toBe(R(850));
  });
  it("vários caixas no mesmo turno somam dentro do turno", () => {
    const a = session("ma", 1, "NEW_OPENING", R(100), R(400), "Manhã");
    const b = { ...session("ma", 1, "NEW_OPENING", R(100), R(600), "Manhã"), sessionId: "s2", registerName: "Caixa 2" };
    const d = consolidateDay([a, b]);
    expect(d.shifts).toHaveLength(1);
    expect(d.shifts[0].sessionCount).toBe(2);
    expect(d.shifts[0].headline.revenueCents).toBe(R(1000));
    expect(d.floatCents).toBe(R(200));
  });
});
