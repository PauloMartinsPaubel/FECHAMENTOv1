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

/** Cabeçalho do "Relatório de Pedidos" do Portal do Parceiro, como no arquivo real de 06/10/2026. */
export const REPORT_HEADER = [
  "ID COMPLETO DO PEDIDO", "NOME DA LOJA", "ID DA LOJA", "DATA E HORA DO PEDIDO", "TURNO", "ID CURTO DO PEDIDO",
  "STATUS FINAL DO PEDIDO", "VALOR DOS ITENS (R$)", "TOTAL PAGO PELO CLIENTE (R$)", "TAXA DE ENTREGA PAGA PELO CLIENTE (R$)",
  "INCENTIVO PROMOCIONAL DO IFOOD (R$)", "INCENTIVO PROMOCIONAL DA LOJA (R$)", "INCENTIVO PROMOCIONAL DA REDE (R$)",
  "TAXA DE SERVIÇO (R$)", "TAXAS E COMISSOES (R$)", "VALOR LIQUIDO (R$)", "FORMA DE PAGAMENTO", "TIPO DE ENTREGA",
  "PRODUTO LOGISTICO", "CANAL DE VENDA",
];

export function reportRow(o: { id: string; short: string; when: string; status?: string; total: number | string; payment: string; items?: number; delivery?: number; incStore?: number; channel?: string }) {
  return [
    o.id, "A Feijoada", 42689, o.when, "ALMOÇO", o.short, o.status ?? "CONCLUIDO", o.items ?? 50, o.total, o.delivery ?? 9.9,
    0, o.incStore ?? 0, 0, 1.16, "", "", o.payment, "ENTREGA", "ENTREGA PROPRIA", o.channel ?? "iFood",
  ];
}

/** Gera um .xlsx mínimo (strings compartilhadas para texto, número para número), como o Excel grava. */
export async function makeXlsx(rows: (string | number)[][]): Promise<Uint8Array> {
  const { zipSync, strToU8 } = await import("fflate");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const shared: string[] = [];
  const col = (i: number) => (i >= 26 ? String.fromCharCode(64 + Math.floor(i / 26)) : "") + String.fromCharCode(65 + (i % 26));
  const sheetRows = rows
    .map((r, ri) => `<row r="${ri + 1}">${r
      .map((v, ci) => {
        const ref = `${col(ci)}${ri + 1}`;
        if (v === "") return "";
        if (typeof v === "number") return `<c r="${ref}"><v>${v}</v></c>`;
        shared.push(v);
        return `<c r="${ref}" t="s"><v>${shared.length - 1}</v></c>`;
      })
      .join("")}</row>`)
    .join("");
  const ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';
  return zipSync({
    "[Content_Types].xml": strToU8("<Types/>"),
    "xl/workbook.xml": strToU8(`<workbook ${ns}><sheets><sheet name="Pedidos" sheetId="1"/></sheets></workbook>`),
    "xl/sharedStrings.xml": strToU8(`<sst ${ns}>${shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("")}</sst>`),
    "xl/worksheets/sheet1.xml": strToU8(`<worksheet ${ns}><sheetData>${sheetRows}</sheetData></worksheet>`),
  });
}
