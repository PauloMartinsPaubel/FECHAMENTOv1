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

describe("eventos e status", () => {
  it("códigos curtos e longos", () => {
    expect(statusFromEventCode("PLC")).toBe("PLACED");
    expect(statusFromEventCode("CAN")).toBe("CANCELLED");
    expect(statusFromEventCode("CONCLUDED")).toBe("CONCLUDED");
    expect(statusFromEventCode("XYZ")).toBeNull();
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
