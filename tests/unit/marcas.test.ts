import { describe, expect, it } from "vitest";
import { evaluateSession, mergeStoreTotals, summarizeSession } from "@/lib/finance";
import { describeStores } from "@/lib/reports/stores";
import { storeSection } from "@/lib/reports/html";
import { catalog, mov, R } from "./helpers";

const stores = [
  { id: "st-feijoada", name: "A Feijoada", sortOrder: 1 },
  { id: "st-prato", name: "Prato e Folha", sortOrder: 2 },
];
const at = (storeId: string | null, m: ReturnType<typeof mov>) => ({ ...m, storeId });

describe("marcas no mesmo caixa", () => {
  const movements = [
    at("st-feijoada", mov("VENDA", "CASH", R(100))),
    at("st-feijoada", mov("VENDA", "PIX", R(50))),
    at("st-prato", mov("VENDA", "CASH", R(30))),
    at("st-prato", mov("VENDA", "ONLINE", R(80), { channelId: "ch-ifood" })),
    at("st-prato", mov("ESTORNO", "PIX", R(10), { description: "devolução" })),
    at("st-feijoada", mov("VENDA", "CREDIT", R(999), { status: "VOIDED" })),
    mov("SANGRIA", "CASH", R(40), { description: "cofre" }),
  ];
  const s = summarizeSession({ openingFloatCents: R(100), movements, cancellations: [] });

  it("separa o faturamento por marca e a soma das marcas é o faturamento do caixa", () => {
    expect(s.revenueCents).toBe(R(250));
    const feij = s.byStore.find((x) => x.storeId === "st-feijoada")!;
    const prato = s.byStore.find((x) => x.storeId === "st-prato")!;
    expect(feij.netCents).toBe(R(150));
    expect(feij.byKind.CASH).toBe(R(100));
    expect(feij.byKind.PIX).toBe(R(50));
    expect(prato.netCents).toBe(R(100));
    expect(prato.byKind.PIX).toBe(-R(10));
    expect(prato.byKind.ONLINE).toBe(R(80));
    expect(prato.byChannel.find((c) => c.channelId === "ch-ifood")?.netCents).toBe(R(80));
    expect(s.integrityIssues).toEqual([]);
  });

  it("a gaveta continua uma só: dinheiro esperado soma as duas marcas e desconta a sangria", () => {
    expect(s.cash.expectedCents).toBe(R(100) + R(100) + R(30) - R(40));
    const ev = evaluateSession({ openingFloatCents: R(100), movements, cancellations: [] }, catalog, {}, 0);
    expect(ev.lines.filter((l) => l.group === "CASH")).toHaveLength(1);
  });

  it("sem marca nenhuma, a separação não aparece (restaurante de uma marca só)", () => {
    const one = summarizeSession({ openingFloatCents: 0, movements: [mov("VENDA", "PIX", R(20))], cancellations: [] });
    expect(one.byStore).toEqual([]);
  });

  it("venda antiga sem marca vai para 'Sem marca', sempre por último", () => {
    const mixed = summarizeSession({
      openingFloatCents: 0,
      movements: [mov("VENDA", "PIX", R(5)), at("st-prato", mov("VENDA", "PIX", R(7))), at("st-feijoada", mov("VENDA", "PIX", R(9)))],
      cancellations: [],
    });
    const lines = describeStores(mixed.byStore, stores, catalog.channels);
    expect(lines.map((l) => [l.name, l.revenueCents])).toEqual([["A Feijoada", R(9)], ["Prato e Folha", R(7)], ["Sem marca", R(5)]]);
  });

  it("dia ou período: junta as marcas de vários caixas", () => {
    const other = summarizeSession({ openingFloatCents: 0, movements: [at("st-prato", mov("VENDA", "DEBIT", R(40)))], cancellations: [] });
    const merged = mergeStoreTotals([s.byStore, other.byStore]);
    expect(merged.find((x) => x.storeId === "st-prato")?.netCents).toBe(R(140));
    expect(merged.find((x) => x.storeId === "st-prato")?.byKind.DEBIT).toBe(R(40));
    expect(merged.reduce((a, x) => a + x.netCents, 0)).toBe(R(290));
  });

  it("a nota mostra uma coluna por marca e o total, por forma e por canal", () => {
    const html = storeSection(describeStores(s.byStore, stores, catalog.channels));
    expect(html).toContain("Faturamento por marca");
    expect(html.indexOf("A Feijoada")).toBeLessThan(html.indexOf("Prato e Folha"));
    expect(html).toContain("Por canal");
    expect(html).toContain("250,00");
    expect(storeSection([])).toBe("");
    expect(storeSection(undefined)).toBe("");
  });
});
