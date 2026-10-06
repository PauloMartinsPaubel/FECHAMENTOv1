import { describe, expect, it } from "vitest";
import { assignShift, decimalToCents, laterStatus, localParts } from "@/server/integrations/shared";
import { cashKindFor, mapIfoodEvent, mapIfoodOrder, statusFromEventCode } from "@/server/integrations/ifood/mapper";
import { ifoodOrder } from "../fixtures/ifood";

describe("decimalToCents", () => {
  it.each([
    [52.9, 5290], [19.99, 1999], [0.1, 10], [0.07, 7], [1005.05, 100505], [0, 0], ["45,90", 4590], ["12.5", 1250], [-3.2, -320],
  ])("%j -> %i", (v, c) => expect(decimalToCents(v)).toBe(c));
  it("rejeita o que não é número", () => {
    expect(decimalToCents(null)).toBeNull();
    expect(decimalToCents("abc")).toBeNull();
    expect(decimalToCents(undefined)).toBeNull();
  });
  it("não erra centavo em valores clássicos de ponto flutuante", () => {
    // 1.15 * 100 = 114.99999999999999 em ponto flutuante
    expect(decimalToCents(1.15)).toBe(115);
    expect(decimalToCents(4.35)).toBe(435);
  });
});

describe("leitura do pedido do iFood", () => {
  it("pedido pago no app: tudo online, nada passa pelo caixa físico", () => {
    const o = mapIfoodOrder(ifoodOrder());
    expect(o).toMatchObject({
      externalId: "a1b2c3d4-0000-0000-0000-000000000001", displayId: "4821", merchantId: "loja-123",
      subtotalCents: 4590, deliveryFeeCents: 700, totalCents: 5290, onlineCents: 5290, offlineCents: 0,
    });
    expect(o.payments).toEqual([{ method: "CREDIT", type: "ONLINE", valueCents: 5290, brand: "VISA", cashKind: "ONLINE" }]);
    expect(o.warnings).toEqual([]);
  });

  it("dinheiro na entrega vai para o dinheiro físico; maquininha na entrega vai para o cartão", () => {
    const o = mapIfoodOrder(ifoodOrder({
      orderAmount: 80, methods: [{ value: 50, method: "CASH", type: "OFFLINE" }, { value: 30, method: "DEBIT", type: "OFFLINE" }],
    }));
    expect(o.onlineCents).toBe(0);
    expect(o.offlineCents).toBe(8000);
    expect(o.payments.map((p) => p.cashKind)).toEqual(["CASH", "DEBIT"]);
  });

  it("pagamento dividido entre app e entrega", () => {
    const o = mapIfoodOrder(ifoodOrder({
      orderAmount: 60, methods: [{ value: 40, method: "PIX", type: "ONLINE" }, { value: 20, method: "MEAL_VOUCHER", type: "OFFLINE" }],
    }));
    expect([o.onlineCents, o.offlineCents]).toEqual([4000, 2000]);
    expect(o.payments[1].cashKind).toBe("TICKET");
  });

  it("sem lista de pagamentos usa pré-pago e a receber, e avisa", () => {
    const raw = ifoodOrder();
    (raw.payments as { methods: unknown[] }).methods = [];
    raw.payments.prepaid = 30;
    raw.payments.pending = 22.9;
    const o = mapIfoodOrder(raw);
    expect([o.onlineCents, o.offlineCents]).toEqual([3000, 2290]);
    expect(o.warnings.join(" ")).toContain("sem lista de pagamentos");
  });

  it("avisa quando a soma dos pagamentos não fecha com pré-pago + a receber", () => {
    const o = mapIfoodOrder(ifoodOrder({ prepaid: 50, pending: 0 }));
    expect(o.warnings.join(" ")).toContain("difere");
  });

  it("total ausente é calculado pelas parcelas, com aviso", () => {
    const raw = ifoodOrder({ subTotal: 40, deliveryFee: 5, benefits: 3 }) as { total: Record<string, unknown> };
    delete raw.total.orderAmount;
    const o = mapIfoodOrder(raw);
    expect(o.totalCents).toBe(4200);
    expect(o.warnings.join(" ")).toContain("orderAmount ausente");
  });

  it("recusa pedido sem id ou sem data", () => {
    expect(() => mapIfoodOrder({})).toThrow(/sem id/);
    expect(() => mapIfoodOrder({ id: "x", createdAt: "ontem" })).toThrow(/data/);
  });
});

describe("pedido no formato da página Estrutura do pedido (Logistics)", () => {
  const base = { id: "4934a1e8-2071-4ac7-9ff6-6e634bb6008d", orderType: "DELIVERY", orderTiming: "IMMEDIATE", displayId: "9843", createdAt: "2024-03-20T14:33:08.052Z", isTest: true, merchant: { id: "b0954b6b", name: "Teste" } };
  it("cartão de crédito na entrega, sem bloco total: valor vem dos pagamentos", () => {
    const o = mapIfoodOrder({ ...base, payments: { prepaid: 0, pending: 323.99, methods: [{ value: 323.99, currency: "BRL", method: "CREDIT", prepaid: false, type: "OFFLINE" }] } });
    expect(o).toMatchObject({ totalCents: 32399, onlineCents: 0, offlineCents: 32399, displayId: "9843", merchantId: "b0954b6b" });
    expect(o.payments[0]).toMatchObject({ cashKind: "CREDIT", brand: null });
    expect(o.warnings).toEqual(expect.arrayContaining([expect.stringContaining("sem bloco total"), expect.stringContaining("teste")]));
  });
  it("dinheiro com troco: o troco não é valor do pedido", () => {
    const o = mapIfoodOrder({ ...base, isTest: false, payments: { prepaid: 0, pending: 103.99, methods: [{ value: 103.99, currency: "BRL", method: "CASH", prepaid: false, type: "OFFLINE", cash: { changeFor: 150 } }] } });
    expect(o).toMatchObject({ totalCents: 10399, offlineCents: 10399 });
    expect(o.payments[0].cashKind).toBe("CASH");
    expect(o.warnings.some((w) => w.includes("teste"))).toBe(false);
  });
  it("sem payments: zerado e avisado, nunca inventa valor", () => {
    const o = mapIfoodOrder(base);
    expect([o.totalCents, o.onlineCents, o.offlineCents]).toEqual([0, 0, 0]);
    expect(o.warnings.some((w) => w.includes("sem lista de pagamentos"))).toBe(true);
  });
  it("carteira digital e vale-presente na entrega caem em Outros", () => {
    expect(cashKindFor("DIGITAL_WALLET", "OFFLINE")).toBe("OTHER");
    expect(cashKindFor("GIFT_CARD", "OFFLINE")).toBe("OTHER");
  });
});

describe("exemplo oficial do módulo Order (entrega, pagamento dividido)", () => {
  const oficial = {
    id: "63895716-37c3-4372-afd0-3240bfef708d", orderTiming: "IMMEDIATE", orderType: "DELIVERY", salesChannel: "IFOOD", category: "FOOD",
    displayId: "XPTO", createdAt: "2021-02-16T18:10:27Z", merchant: { id: "c54bb20a", name: "Example Merchant" },
    total: { subTotal: 3.13, deliveryFee: 5.99, additionalFees: 1, benefits: 1.99, orderAmount: 8.13 },
    payments: { prepaid: 2.13, pending: 5, methods: [
      { value: 5, currency: "BRL", method: "CASH ", type: "OFFLINE", prepaid: false },
      { value: 2.13, currency: "BRL", method: "CREDIT", type: "ONLINE", prepaid: true, card: { brand: "VISA" } },
    ] },
    test: false,
  };
  it("lê total e pagamentos sem aviso, inclusive o método com espaço sobrando", () => {
    const o = mapIfoodOrder(oficial);
    expect(o).toMatchObject({ subtotalCents: 313, deliveryFeeCents: 599, benefitsCents: 199, totalCents: 813, onlineCents: 213, offlineCents: 500 });
    expect(o.payments.map((p) => [p.method, p.cashKind, p.brand])).toEqual([["CASH", "CASH", null], ["CREDIT", "ONLINE", "VISA"]]);
    expect(o.warnings).toEqual([]);
  });
  it("pedido de outro canal de vendas é avisado", () => {
    expect(mapIfoodOrder({ ...oficial, salesChannel: "DIGITAL_CATALOG" }).warnings.join()).toContain("DIGITAL_CATALOG");
    expect(mapIfoodOrder({ ...oficial, test: true }).warnings.join()).toContain("teste");
  });
});

describe("eventos e status", () => {
  it("códigos curtos e longos", () => {
    expect(statusFromEventCode("PLC")).toBe("PLACED");
    expect(statusFromEventCode("CAN")).toBe("CANCELLED");
    expect(statusFromEventCode("CONCLUDED")).toBe("CONCLUDED");
    expect(statusFromEventCode("XYZ")).toBeNull();
  });
  it("código completo com prefixo ORDER_, como no catálogo de eventos", () => {
    expect(statusFromEventCode("ORDER_CONFIRMED")).toBe("CONFIRMED");
    expect(statusFromEventCode("ORDER_CANCELLED")).toBe("CANCELLED");
    expect(statusFromEventCode(" order_placed ")).toBe("PLACED");
  });
  it("pedido de cancelamento e cancelamento recusado não cancelam o pedido", () => {
    expect(statusFromEventCode("CANCELLATION_REQUESTED")).toBeNull();
    expect(statusFromEventCode("CANCELLATION_REQUEST_FAILED")).toBeNull();
    expect(statusFromEventCode("ORDER_CANCELLATION_REQUEST_FAILED")).toBeNull();
  });
  it("status só avança; cancelado vence tudo", () => {
    expect(laterStatus("CONCLUDED", "CONFIRMED")).toBe("CONCLUDED");
    expect(laterStatus("CONCLUDED", "CANCELLED")).toBe("CANCELLED");
    expect(laterStatus("CANCELLED", "CONCLUDED")).toBe("CANCELLED");
    expect(laterStatus(undefined, "PLACED")).toBe("PLACED");
  });
  it("evento sem id ou código é descartado", () => {
    expect(mapIfoodEvent({ code: "PLC" })).toBeNull();
    expect(mapIfoodEvent({ id: "e1", code: "PLC", orderId: "o1" })).toMatchObject({ id: "e1", orderId: "o1" });
  });
  it("evento no formato da documentação: code, fullCode, orderId, createdAt, metadata", () => {
    const e = mapIfoodEvent({ id: "evt_123", code: "CONFIRMED", fullCode: "ORDER_CONFIRMED", orderId: "ord_456", createdAt: "2024-04-25T18:00:00Z", metadata: {} });
    expect(e).toMatchObject({ id: "evt_123", code: "CONFIRMED", fullCode: "ORDER_CONFIRMED", status: "CONFIRMED", orderId: "ord_456" });
    expect(e?.createdAt?.toISOString()).toBe("2024-04-25T18:00:00.000Z");
  });
  it("só com fullCode, usa ele; código que não muda status vem com status nulo", () => {
    expect(mapIfoodEvent({ id: "e2", fullCode: "ORDER_DISPATCHED", orderId: "o" })).toMatchObject({ code: "ORDER_DISPATCHED", status: "DISPATCHED" });
    expect(mapIfoodEvent({ id: "e3", code: "CANCELLATION_REQUEST_FAILED", orderId: "o" })).toMatchObject({ status: null });
  });
  it("o detalhe do pedido informa o próprio status quando informa", () => {
    expect(mapIfoodOrder(ifoodOrder({ id: "p1" })).reportedStatus).toBeNull();
    expect(mapIfoodOrder({ ...ifoodOrder({ id: "p2" }), status: "CONFIRMED" }).reportedStatus).toBe("CONFIRMED");
  });
  it("forma do pagamento na entrega para a conferência do caixa", () => {
    expect(cashKindFor("CASH", "OFFLINE")).toBe("CASH");
    expect(cashKindFor("CASH", "ONLINE")).toBe("ONLINE");
    expect(cashKindFor("FOOD_VOUCHER", "OFFLINE")).toBe("TICKET");
    expect(cashKindFor("ALGO_NOVO", "OFFLINE")).toBe("OTHER");
  });
});

describe("dia de negócio e turno do pedido (fuso de São Paulo)", () => {
  const shifts = [
    { id: "manha", startTime: "06:00", endTime: "15:00", sortOrder: 1 },
    { id: "noite", startTime: "15:00", endTime: "23:59", sortOrder: 2 },
  ];
  it("converte para o horário local", () => {
    expect(localParts(new Date("2026-10-06T15:30:00Z"))).toEqual({ date: "2026-10-06", time: "12:30" });
  });
  it("almoço cai na manhã, jantar na tarde/noite", () => {
    expect(assignShift(new Date("2026-10-06T15:30:00Z"), shifts)).toEqual({ businessDate: "2026-10-06", shiftId: "manha" });
    expect(assignShift(new Date("2026-10-06T22:00:00Z"), shifts)).toEqual({ businessDate: "2026-10-06", shiftId: "noite" });
  });
  it("pedido às 23:59:30 fica na tarde/noite do mesmo dia", () => {
    expect(assignShift(new Date("2026-10-07T02:59:30Z"), shifts)).toEqual({ businessDate: "2026-10-06", shiftId: "noite" });
  });
  it("pedido de madrugada (00:40) pertence à tarde/noite do dia anterior", () => {
    expect(assignShift(new Date("2026-10-07T03:40:00Z"), shifts)).toEqual({ businessDate: "2026-10-06", shiftId: "noite" });
  });
});
