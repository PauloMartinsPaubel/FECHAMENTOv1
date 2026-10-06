import { describe, expect, it } from "vitest";
import { localDateTimeToUtc, parseIfoodOrdersReport, readXlsxRows, reportMoneyToCents, reportPayment } from "@/server/integrations/ifood/report";
import { makeXlsx, REPORT_HEADER, reportRow } from "../fixtures/ifood";

const TZ = "America/Sao_Paulo";

describe("relatório de pedidos do Portal do Parceiro", () => {
  it("lê o arquivo com as colunas do relatório real", async () => {
    const file = await makeXlsx([
      REPORT_HEADER,
      reportRow({ id: "1b2e9f71", short: "8419", when: "06/10/2026 13:42:49", status: "DISPATCHED", total: 118.39, payment: "Pgto via APP - Crédito (Visa)" }),
      reportRow({ id: "aa11", short: "4629", when: "06/10/2026 13:08:10", total: 71.06, payment: "Outros vales" }),
      reportRow({ id: "bb22", short: "0638", when: "06/10/2026 13:26:29", total: 135.29, payment: "Pgto via APP - Carteira Digital (Mastercard)", incStore: 10 }),
      reportRow({ id: "cc33", short: "7000", when: "06/10/2026 20:15:00", status: "CANCELADO", total: 40, payment: "Dinheiro" }),
    ]);
    const p = parseIfoodOrdersReport(readXlsxRows(file), TZ);
    expect(p.errors).toEqual([]);
    expect(p.orders).toHaveLength(4);
    const [a, b, c, d] = p.orders;
    expect(a).toMatchObject({ externalId: "1b2e9f71", displayId: "8419", status: "DISPATCHED", totalCents: 11839, onlineCents: 11839, offlineCents: 0 });
    expect(a.placedAt.toISOString()).toBe("2026-10-06T16:42:49.000Z");
    expect(a.payments[0]).toMatchObject({ type: "ONLINE", cashKind: "ONLINE", method: "CREDIT", brand: "Visa" });
    // sem "via APP": recebido na entrega; vale vai para a conferência de tickets
    expect(b).toMatchObject({ onlineCents: 0, offlineCents: 7106 });
    expect(b.payments[0]).toMatchObject({ type: "OFFLINE", cashKind: "TICKET" });
    expect(c).toMatchObject({ totalCents: 13529, benefitsCents: 1000 });
    expect(d).toMatchObject({ status: "CANCELLED", offlineCents: 4000 });
    expect(d.payments[0].cashKind).toBe("CASH");
  });

  it("linhas com problema não derrubam o arquivo: viram erro com o número da linha", async () => {
    const file = await makeXlsx([
      REPORT_HEADER,
      reportRow({ id: "ok1", short: "1", when: "06/10/2026 12:00:00", total: 10, payment: "Pgto via APP - PIX" }),
      reportRow({ id: "x2", short: "2", when: "2026-10-06", total: 10, payment: "Pgto via APP - PIX" }),
      reportRow({ id: "x3", short: "3", when: "06/10/2026 12:00:00", total: "abc", payment: "Pgto via APP - PIX" }),
      reportRow({ id: "ok1", short: "1", when: "06/10/2026 12:00:00", total: 10, payment: "Pgto via APP - PIX" }),
    ]);
    const p = parseIfoodOrdersReport(readXlsxRows(file), TZ);
    expect(p.orders.map((o) => o.externalId)).toEqual(["ok1"]);
    expect(p.errors).toEqual([expect.stringMatching(/^Linha 3: data/), expect.stringMatching(/^Linha 4: total/)]);
    expect(p.warnings).toEqual([expect.stringMatching(/repetido/)]);
  });

  it("recusa arquivo que não é o relatório de pedidos, ou que não é planilha", async () => {
    expect(() => parseIfoodOrdersReport([["NOME", "VALOR"]], TZ)).toThrow(/Relatório de Pedidos/);
    expect(() => parseIfoodOrdersReport([["ID COMPLETO DO PEDIDO", "DATA E HORA DO PEDIDO"]], TZ)).toThrow(/Faltam colunas.*TOTAL PAGO/);
    expect(() => readXlsxRows(new TextEncoder().encode("isto não é zip"))).toThrow(/xlsx válida/);
  });

  it("pedido de outro canal de venda é avisado", async () => {
    const file = await makeXlsx([REPORT_HEADER, reportRow({ id: "d1", short: "9", when: "06/10/2026 12:00:00", total: 30, payment: "Pgto via APP - PIX", channel: "Cardápio Digital" })]);
    expect(parseIfoodOrdersReport(readXlsxRows(file), TZ).warnings.join()).toContain("Cardápio Digital");
  });

  it("valores em número ou em texto brasileiro, e horário local para UTC", () => {
    expect(reportMoneyToCents("118.39")).toBe(11839);
    expect(reportMoneyToCents("1.234,56")).toBe(123456);
    expect(reportMoneyToCents("R$ 10,00")).toBe(1000);
    expect(reportMoneyToCents("")).toBeNull();
    expect(localDateTimeToUtc("06/10/2026 23:59:30", TZ)?.toISOString()).toBe("2026-10-07T02:59:30.000Z");
    expect(localDateTimeToUtc("06/10/2026", TZ)).toBeNull();
  });

  it("formas de pagamento conhecidas", () => {
    expect(reportPayment("Pgto via APP - Vale Refeição (VR)")).toMatchObject({ type: "ONLINE", kind: "ONLINE", method: "MEAL_VOUCHER", brand: "VR" });
    expect(reportPayment("Cartão de Débito na entrega (Elo)")).toMatchObject({ type: "OFFLINE", kind: "DEBIT" });
    expect(reportPayment("Cartão de Crédito na entrega")).toMatchObject({ type: "OFFLINE", kind: "CREDIT" });
    expect(reportPayment("Dinheiro")).toMatchObject({ type: "OFFLINE", kind: "CASH" });
    expect(reportPayment("Algo novo")).toMatchObject({ type: "OFFLINE", kind: "OTHER" });
  });
});
