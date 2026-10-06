/** Pedidos de exemplo no formato da Merchant API (Order v1.0). Conferir com a documentação oficial. */
export function ifoodOrder(over: Partial<{
  id: string; displayId: string; createdAt: string; merchantId: string;
  subTotal: number; deliveryFee: number; benefits: number; orderAmount: number;
  methods: { value: number; method: string; type: string; brand?: string }[];
  prepaid: number; pending: number;
}> = {}) {
  const methods = over.methods ?? [{ value: 52.9, method: "CREDIT", type: "ONLINE", brand: "VISA" }];
  return {
    id: over.id ?? "a1b2c3d4-0000-0000-0000-000000000001",
    displayId: over.displayId ?? "4821",
    createdAt: over.createdAt ?? "2026-10-06T15:30:00.000Z",
    orderType: "DELIVERY",
    salesChannel: "IFOOD",
    merchant: { id: over.merchantId ?? "loja-123", name: "Restaurante" },
    total: {
      subTotal: over.subTotal ?? 45.9,
      deliveryFee: over.deliveryFee ?? 7,
      benefits: over.benefits ?? 0,
      additionalFees: 0,
      orderAmount: over.orderAmount ?? 52.9,
    },
    payments: {
      prepaid: over.prepaid ?? methods.filter((m) => m.type === "ONLINE").reduce((a, m) => a + m.value, 0),
      pending: over.pending ?? methods.filter((m) => m.type === "OFFLINE").reduce((a, m) => a + m.value, 0),
      methods: methods.map((m) => ({ value: m.value, currency: "BRL", method: m.method, type: m.type, card: m.brand ? { brand: m.brand } : undefined })),
    },
  };
}

export function ifoodEvent(id: string, code: string, orderId: string, createdAt = "2026-10-06T15:30:05.000Z", merchantId = "loja-123") {
  return { id, code, fullCode: code, orderId, merchantId, createdAt };
}
