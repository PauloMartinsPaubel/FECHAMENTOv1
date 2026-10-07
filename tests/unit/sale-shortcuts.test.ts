import { describe, expect, it } from "vitest";
import { rankSaleShortcuts } from "@/lib/sale-shortcuts";

const catalog = {
  channels: [{ id: "balcao", name: "Balcão" }, { id: "ifood", name: "iFood" }],
  methods: [
    { id: "din", name: "Dinheiro", kind: "CASH" },
    { id: "pix", name: "PIX", kind: "PIX" },
    { id: "cred", name: "Cartão de crédito", kind: "CREDIT" },
    { id: "deb", name: "Cartão de débito", kind: "DEBIT" },
    { id: "tick", name: "Ticket / Vale", kind: "TICKET" },
    { id: "onl", name: "Pagamento online", kind: "ONLINE" },
  ],
  brands: [{ id: "vr", name: "VR" }],
};

describe("atalhos do lançamento rápido", () => {
  it("as combinações mais usadas primeiro, no máximo 6", () => {
    const r = rankSaleShortcuts(
      [
        { channelId: "balcao", paymentMethodId: "pix", ticketBrandId: null, count: 12 },
        { channelId: "ifood", paymentMethodId: "onl", ticketBrandId: null, count: 40 },
        { channelId: "balcao", paymentMethodId: "din", ticketBrandId: null, count: 12 },
        { channelId: "balcao", paymentMethodId: "tick", ticketBrandId: "vr", count: 3 },
      ],
      catalog,
    );
    // histórico primeiro; depois completa com os padrão que ainda não estão (crédito e débito)
    expect(r.map((s) => s.label)).toEqual([
      "iFood · Pagamento online", "Balcão · Dinheiro", "Balcão · PIX", "Balcão · VR", "Balcão · Cartão de crédito", "Balcão · Cartão de débito",
    ]);
    expect(r[3]).toMatchObject({ paymentMethodId: "tick", ticketBrandId: "vr" });
    expect(r.map((s) => s.uses)).toEqual([40, 12, 12, 3, 0, 0]);
    const many = Array.from({ length: 10 }, (_, i) => ({ channelId: "balcao", paymentMethodId: "din", ticketBrandId: null, count: i + 1 }));
    expect(rankSaleShortcuts(many, catalog, 6)).toHaveLength(6);
  });

  it("ignora canal ou forma desativados e ticket sem bandeira", () => {
    const r = rankSaleShortcuts(
      [
        { channelId: "removido", paymentMethodId: "pix", ticketBrandId: null, count: 50 },
        { channelId: "balcao", paymentMethodId: "removida", ticketBrandId: null, count: 50 },
        { channelId: "balcao", paymentMethodId: "tick", ticketBrandId: null, count: 50 },
        { channelId: null, paymentMethodId: "pix", ticketBrandId: null, count: 50 },
        { channelId: "balcao", paymentMethodId: "deb", ticketBrandId: null, count: 1 },
      ],
      catalog,
    );
    expect(r.map((s) => s.label)).toEqual(["Balcão · Cartão de débito", "Balcão · Dinheiro", "Balcão · PIX", "Balcão · Cartão de crédito"]);
  });

  it("sem histórico, sugere o primeiro canal com dinheiro, PIX, crédito e débito", () => {
    const r = rankSaleShortcuts([], catalog);
    expect(r.map((s) => s.label)).toEqual(["Balcão · Dinheiro", "Balcão · PIX", "Balcão · Cartão de crédito", "Balcão · Cartão de débito"]);
    expect(r.every((s) => s.uses === 0)).toBe(true);
    expect(rankSaleShortcuts([], { channels: [], methods: catalog.methods, brands: [] })).toEqual([]);
  });
});
