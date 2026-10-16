import { z } from "zod";
import { APP_TIMEZONE } from "@/lib/dates";
import { decimalToCents } from "../shared";
import { localDateTimeToUtc } from "../ifood/report";

/**
 * O que o programa instalado no restaurante manda a cada envio. Os nomes seguem a Eclética
 * (glossário do Eclética B.I). Cada turno vem inteiro: vendas e sangrias substituem as anteriores.
 * Dados de cliente (nome, telefone, CPF, endereço) não fazem parte do envio.
 */
const text = (max: number) => z.string().trim().max(max);
const optText = (max: number) => text(max).nullish().transform((v) => (v ? v : null));
/** valor como o MySQL devolve DECIMAL: texto "12.50" (ou número) */
const money = z.union([z.string().max(30), z.number()]).nullish();
/** data e hora local da Eclética: "2026-10-16 13:42:07" */
const localDateTime = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?$/, "data e hora no formato AAAA-MM-DD HH:MM:SS");

export const MAX_TURNOS = 40;
export const MAX_VENDAS = 10_000;

const detalheSchema = z.object({ tipoDet: text(20), codDet: text(20), valor: money });

const vendaSchema = z.object({
  /** cod_ctrl:num_ticket */
  chave: text(80).min(1),
  estabelecimento: optText(40),
  abertura: localDateTime.nullish(),
  fechamento: localDateTime.nullish(),
  tipo: optText(5),
  origem: optText(60),
  situacao: text(5).min(1),
  total: money,
  desconto: money,
  servico: money,
  colunas: z
    .object({ dinheiro: money, cartao: money, cheque: money, vale_ref: money, outros: money, fiado: money })
    .partial()
    .default({}),
  troco: money,
  repique: money,
  detalhes: z.array(detalheSchema).max(30).default([]),
  pedidoExterno: optText(80),
  canceladaEm: localDateTime.nullish(),
  motivoCancelamento: optText(300),
});

const sangriaSchema = z.object({
  data: localDateTime.nullish(),
  operador: optText(80),
  d: money,
  t: money,
  c: money,
  tipo: optText(40),
  motivo: optText(300),
});

const turnoSchema = z.object({
  codigo: text(40).min(1),
  aberto: z.boolean().default(false),
  abertura: localDateTime,
  fechamento: localDateTime.nullish(),
  fundo: money,
  valorFechamento: money,
  maquina: optText(80),
  operador: optText(80),
  vendas: z.array(vendaSchema).max(5_000).default([]),
  sangrias: z.array(sangriaSchema).max(500).default([]),
});

export const payloadSchema = z.object({
  versao: text(40).default("?"),
  catalogo: z
    .object({
      formas: z.array(z.object({ tipoDet: text(20), codDet: text(20), descricao: optText(120) })).max(500).default([]),
      canais: z.array(z.object({ flagDely: text(5), origem: text(60), integrador: optText(120) })).max(500).default([]),
      estabelecimentos: z.array(z.object({ codigo: text(40), nome: optText(120) })).max(100).default([]),
    })
    .partial()
    .default({}),
  turnos: z.array(turnoSchema).max(MAX_TURNOS),
});

export type EcleticaPayload = z.infer<typeof payloadSchema>;

/** Colunas de pagamento da venda, na ordem do glossário. */
export const PAYMENT_COLUMNS = ["dinheiro", "cartao", "cheque", "vale_ref", "outros", "fiado"] as const;
export type PaymentColumn = (typeof PAYMENT_COLUMNS)[number];

export function cents(value: unknown): number {
  const c = decimalToCents(value);
  if (c === null) return 0;
  if (Math.abs(c) > 100_000_000_00) throw new Error("Valor fora do limite.");
  return c;
}

/** Horário local da Eclética no instante exato, no fuso do restaurante. */
export function localToUtc(value: string | null | undefined, timeZone: string = APP_TIMEZONE): Date | null {
  if (!value) return null;
  const m = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s = "00"] = m;
  return localDateTimeToUtc(`${d}/${mo}/${y} ${h}:${mi}:${s}`, timeZone);
}

/** Valida o envio e devolve a primeira mensagem de erro legível, ou o conteúdo já conferido. */
export function parsePayload(body: unknown): { ok: true; data: EcleticaPayload } | { ok: false; error: string } {
  const r = payloadSchema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    return { ok: false, error: `Envio inválido em ${issue.path.join(".") || "(raiz)"}: ${issue.message}` };
  }
  const vendas = r.data.turnos.reduce((a, t) => a + t.vendas.length, 0);
  if (vendas > MAX_VENDAS) return { ok: false, error: `Envio grande demais (${vendas} vendas). Mande no máximo ${MAX_VENDAS} por vez.` };
  return { ok: true, data: r.data };
}
