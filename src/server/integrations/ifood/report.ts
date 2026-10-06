/**
 * Leitura do "Relatório de Pedidos" exportado no Portal do Parceiro do iFood (Pedidos > Exportar), em .xlsx.
 *
 * Colunas usadas (cabeçalho da primeira linha, conferido com um arquivo real de 06/10/2026):
 *   ID COMPLETO DO PEDIDO, ID CURTO DO PEDIDO, ID DA LOJA, DATA E HORA DO PEDIDO (horário local, dd/mm/aaaa hh:mm:ss),
 *   STATUS FINAL DO PEDIDO, VALOR DOS ITENS (R$), TOTAL PAGO PELO CLIENTE (R$), TAXA DE ENTREGA PAGA PELO CLIENTE (R$),
 *   INCENTIVO PROMOCIONAL DO IFOOD / DA LOJA / DA REDE (R$), FORMA DE PAGAMENTO, TIPO DE ENTREGA, CANAL DE VENDA.
 *
 * O valor comparado com o caixa é o TOTAL PAGO PELO CLIENTE: é o que a recepção lança (com a taxa de serviço).
 * A coluna TURNO do iFood é ignorada: o turno sai do horário, pelos turnos cadastrados no sistema.
 */
import { unzipSync, strFromU8 } from "fflate";
import type { PaymentKind } from "@/lib/finance";
import { decimalToCents, NormalizedOrder, NormalizedPayment, OrderStatus } from "../shared";
import { statusFromEventCode } from "./mapper";

const MAX_ROWS = 5000;

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textOf(xml: string): string {
  let out = "";
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += m[1];
  return decodeXml(out);
}

function colIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, "").toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Linhas da primeira planilha de um .xlsx, como texto. */
export function readXlsxRows(data: Uint8Array): string[][] {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(data, { filter: (f) => f.name.startsWith("xl/") && f.name.endsWith(".xml") });
  } catch {
    throw new Error("O arquivo não é uma planilha .xlsx válida.");
  }
  const sheetName = Object.keys(files)
    .filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))[0];
  if (!sheetName) throw new Error("A planilha não tem nenhuma aba com dados.");

  const shared: string[] = [];
  const ss = files["xl/sharedStrings.xml"];
  if (ss) for (const m of strFromU8(ss).matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(textOf(m[1]));

  const rows: string[][] = [];
  for (const rm of strFromU8(files[sheetName]).matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
    if (rows.length > MAX_ROWS) throw new Error(`Planilha com mais de ${MAX_ROWS} linhas. Exporte um período menor.`);
    const row: string[] = [];
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const body = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const type = attrs.match(/\bt="(\w+)"/)?.[1];
      const v = body.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let value = "";
      if (type === "s" && v !== undefined) value = shared[Number(v)] ?? "";
      else if (type === "inlineStr") value = textOf(body);
      else if (v !== undefined) value = decodeXml(v);
      row[ref ? colIndex(ref) : row.length] = value.trim();
    }
    rows.push(Array.from(row, (c) => c ?? ""));
  }
  return rows;
}

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/\s+/g, " ").trim();

/** Valor como o relatório traz: número ("118.39") ou texto em formato brasileiro ("1.234,56"). */
export function reportMoneyToCents(raw: string | undefined): number | null {
  const s = (raw ?? "").replace(/R\$\s?/i, "").trim();
  if (!s) return null;
  const br = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  return decimalToCents(br);
}

/** "06/10/2026 13:42:49" no fuso informado para o instante exato. */
export function localDateTimeToUtc(raw: string, timeZone: string): Date | null {
  const m = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, mi, ss = "0"] = m;
  const asUtc = Date.UTC(+yyyy, +mm - 1, +dd, +hh, +mi, +ss);
  // diferença entre o relógio local e o UTC naquele instante (vale com horário de verão)
  const offsetAt = (t: number) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t;
  };
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

const STATUS_PT: Record<string, OrderStatus> = {
  CONCLUIDO: "CONCLUDED",
  CANCELADO: "CANCELLED",
  CONFIRMADO: "CONFIRMED",
  DESPACHADO: "DISPATCHED",
  "SAIU PARA ENTREGA": "DISPATCHED",
  PRONTO: "READY",
  NOVO: "PLACED",
};

/** Forma de pagamento do relatório ("Pgto via APP - Crédito (Visa)", "Dinheiro"...) para a conferência. */
export function reportPayment(raw: string): { type: "ONLINE" | "OFFLINE"; kind: PaymentKind; method: string; brand: string | null } {
  const n = norm(raw);
  const online = n.includes("VIA APP") || n.includes("ONLINE");
  const brand = raw.match(/\(([^)]+)\)\s*$/)?.[1]?.trim() ?? null;
  let kind: PaymentKind = "OTHER";
  let method = "OTHER";
  if (n.includes("DINHEIRO")) [kind, method] = ["CASH", "CASH"];
  else if (n.includes("PIX")) [kind, method] = ["PIX", "PIX"];
  else if (n.includes("DEBITO")) [kind, method] = ["DEBIT", "DEBIT"];
  else if (n.includes("CREDITO")) [kind, method] = ["CREDIT", "CREDIT"];
  else if (/VALE|REFEICAO|ALIMENTACAO|TICKET/.test(n)) [kind, method] = ["TICKET", "MEAL_VOUCHER"];
  else if (n.includes("CARTEIRA DIGITAL")) [kind, method] = ["OTHER", "DIGITAL_WALLET"];
  return online ? { type: "ONLINE", kind: "ONLINE", method, brand } : { type: "OFFLINE", kind, method, brand };
}

export interface ReportOrder extends NormalizedOrder {
  status: OrderStatus;
  /** linha da planilha, para os avisos */
  line: number;
}

export interface ParsedReport {
  orders: ReportOrder[];
  /** linhas que não puderam ser lidas (não entram na conferência) */
  errors: string[];
  warnings: string[];
}

const REQUIRED = {
  id: "ID COMPLETO DO PEDIDO",
  date: "DATA E HORA DO PEDIDO",
  status: "STATUS FINAL DO PEDIDO",
  total: "TOTAL PAGO PELO CLIENTE (R$)",
  payment: "FORMA DE PAGAMENTO",
} as const;
const OPTIONAL = {
  displayId: "ID CURTO DO PEDIDO",
  merchantId: "ID DA LOJA",
  items: "VALOR DOS ITENS (R$)",
  delivery: "TAXA DE ENTREGA PAGA PELO CLIENTE (R$)",
  incIfood: "INCENTIVO PROMOCIONAL DO IFOOD (R$)",
  incStore: "INCENTIVO PROMOCIONAL DA LOJA (R$)",
  incChain: "INCENTIVO PROMOCIONAL DA REDE (R$)",
  deliveryType: "TIPO DE ENTREGA",
  channel: "CANAL DE VENDA",
} as const;

export function parseIfoodOrdersReport(rows: string[][], timeZone: string): ParsedReport {
  const headerAt = rows.findIndex((r) => r.some((c) => norm(c) === REQUIRED.id));
  if (headerAt < 0) {
    throw new Error('Este arquivo não parece o "Relatório de Pedidos" do iFood (não achei a coluna ID COMPLETO DO PEDIDO).');
  }
  const header = rows[headerAt].map(norm);
  const col = (name: string) => header.indexOf(norm(name));
  const missing = Object.values(REQUIRED).filter((n) => col(n) < 0);
  if (missing.length) throw new Error(`Faltam colunas no relatório do iFood: ${missing.join(", ")}.`);

  const idx = Object.fromEntries([...Object.entries(REQUIRED), ...Object.entries(OPTIONAL)].map(([k, n]) => [k, col(n)])) as Record<
    keyof typeof REQUIRED | keyof typeof OPTIONAL,
    number
  >;
  const get = (r: string[], k: keyof typeof idx) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() : "");

  const orders: ReportOrder[] = [];
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  rows.slice(headerAt + 1).forEach((r, i) => {
    const line = headerAt + 2 + i;
    if (r.every((c) => !c)) return;
    const externalId = get(r, "id");
    if (!externalId) return errors.push(`Linha ${line}: sem ID do pedido.`);
    if (seen.has(externalId)) return warnings.push(`Linha ${line}: pedido ${externalId} repetido no arquivo; usada a primeira linha.`);
    const placedAt = localDateTimeToUtc(get(r, "date"), timeZone);
    if (!placedAt) return errors.push(`Linha ${line}: data e hora "${get(r, "date")}" fora do formato dd/mm/aaaa hh:mm:ss.`);
    const totalCents = reportMoneyToCents(get(r, "total"));
    if (totalCents === null || totalCents < 0) return errors.push(`Linha ${line}: total pago pelo cliente inválido ("${get(r, "total")}").`);

    const statusRaw = norm(get(r, "status"));
    const status = STATUS_PT[statusRaw] ?? statusFromEventCode(statusRaw);
    if (!status) return errors.push(`Linha ${line}: situação "${get(r, "status")}" desconhecida.`);

    const pay = reportPayment(get(r, "payment"));
    const own: string[] = [];
    if (!get(r, "payment")) own.push("sem forma de pagamento; considerada paga no app");
    const channel = get(r, "channel");
    if (channel && norm(channel) !== "IFOOD") own.push(`canal de venda "${channel}"`);

    const cents = (k: keyof typeof idx) => Math.max(0, reportMoneyToCents(get(r, k)) ?? 0);
    const payment: NormalizedPayment = {
      method: pay.method,
      type: get(r, "payment") ? pay.type : "ONLINE",
      valueCents: totalCents,
      brand: pay.brand,
      cashKind: get(r, "payment") ? pay.kind : "ONLINE",
    };
    seen.add(externalId);
    orders.push({
      line,
      status,
      externalId,
      displayId: get(r, "displayId") || null,
      merchantId: get(r, "merchantId") || null,
      placedAt,
      orderType: get(r, "deliveryType") || null,
      reportedStatus: status,
      subtotalCents: cents("items"),
      deliveryFeeCents: cents("delivery"),
      benefitsCents: cents("incIfood") + cents("incStore") + cents("incChain"),
      totalCents,
      onlineCents: payment.type === "ONLINE" ? totalCents : 0,
      offlineCents: payment.type === "OFFLINE" ? totalCents : 0,
      payments: [payment],
      warnings: own,
    });
    for (const w of own) warnings.push(`Pedido ${get(r, "displayId") || externalId}: ${w}.`);
  });

  return { orders, errors, warnings };
}
