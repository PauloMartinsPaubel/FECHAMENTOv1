import { strToU8, zipSync } from "fflate";
import { todayIso } from "@/lib/dates";
import { moneyCell, toCsv, type CsvCell } from "@/lib/reports/csv";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";

/**
 * Tudo o que o restaurante lançou, uma planilha por assunto. Cada consulta filtra pelo restaurante
 * (direto ou pelo caixa/fechamento a que a linha pertence). Senhas cifradas e controles de login ficam de fora.
 */
const SHEETS: { file: string; title: string; sql: string }[] = [
  { file: "restaurante", title: "Dados do restaurante", sql: `SELECT id, name, document, timezone, "createdAt", "billingPlan", "trialEndsAt", "billingDocument", "billingEmail" FROM restaurants WHERE id = $1` },
  { file: "configuracoes", title: "Configurações", sql: `SELECT * FROM settings WHERE "restaurantId" = $1` },
  { file: "usuarios", title: "Usuários", sql: `SELECT u.id, u.name, u.email, r.code AS role, u.active, u."lastLoginAt", u."createdAt" FROM users u JOIN roles r ON r.id = u."roleId" WHERE u."restaurantId" = $1 ORDER BY u.name` },
  { file: "acessos_de_outras_unidades", title: "Acessos de outras unidades", sql: `SELECT m.id, u.name, u.email, r.code AS role, m.active, m."createdAt" FROM memberships m JOIN users u ON u.id = m."userId" JOIN roles r ON r.id = m."roleId" WHERE m."restaurantId" = $1` },
  { file: "caixas", title: "Caixas", sql: `SELECT * FROM cash_registers WHERE "restaurantId" = $1 ORDER BY "sortOrder"` },
  { file: "turnos", title: "Turnos", sql: `SELECT * FROM shifts WHERE "restaurantId" = $1 ORDER BY "sortOrder"` },
  { file: "canais", title: "Canais de venda", sql: `SELECT * FROM sales_channels WHERE "restaurantId" = $1` },
  { file: "formas_de_pagamento", title: "Formas de pagamento", sql: `SELECT * FROM payment_methods WHERE "restaurantId" = $1` },
  { file: "bandeiras", title: "Bandeiras de ticket", sql: `SELECT * FROM ticket_brands WHERE "restaurantId" = $1` },
  { file: "caixas_abertos_e_fechados", title: "Caixas por turno", sql: `SELECT * FROM cash_sessions WHERE "restaurantId" = $1 ORDER BY "businessDate", "createdAt"` },
  { file: "movimentacoes", title: "Vendas e movimentações", sql: `SELECT * FROM cash_movements WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
  { file: "pedidos_cancelados", title: "Pedidos cancelados", sql: `SELECT * FROM cancellations WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
  { file: "conferencias", title: "Conferências", sql: `SELECT c.* FROM closing_conferences c JOIN cash_sessions s ON s.id = c."sessionId" WHERE s."restaurantId" = $1 ORDER BY c."createdAt"` },
  { file: "fechamentos", title: "Fechamentos", sql: `SELECT * FROM cash_closings WHERE "restaurantId" = $1 ORDER BY "closedAt"` },
  { file: "fechamentos_detalhe", title: "Detalhe dos fechamentos", sql: `SELECT d.* FROM closing_details d JOIN cash_closings c ON c.id = d."closingId" WHERE c."restaurantId" = $1` },
  { file: "correcoes", title: "Correções", sql: `SELECT * FROM adjustments WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
  { file: "emails_enviados", title: "E-mails enviados", sql: `SELECT * FROM email_logs WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
  { file: "pedidos_ifood", title: "Pedidos do iFood", sql: `SELECT * FROM platform_orders WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
  { file: "mensalidades", title: "Mensalidades", sql: `SELECT * FROM billing_payments WHERE "restaurantId" = $1 ORDER BY "dueDate"` },
  { file: "auditoria", title: "Auditoria", sql: `SELECT * FROM audit_logs WHERE "restaurantId" = $1 ORDER BY "createdAt"` },
];

/** Colunas que nunca saem: cópia interna do relatório (já está nas outras planilhas) e segredos. */
const SKIP = new Set(["snapshot", "passwordHash", "tokenHash"]);

function cell(key: string, v: unknown): CsvCell {
  if (v === null || v === undefined) return null;
  if (key.endsWith("Cents") && typeof v === "number") return moneyCell(v);
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "sim" : "não";
  return JSON.stringify(v);
}

function header(key: string): string {
  return key.endsWith("Cents") ? `${key.slice(0, -5)} (R$)` : key;
}

export async function buildFullExport(actor: Actor): Promise<{ filename: string; zip: Uint8Array; counts: Record<string, number> }> {
  assertCan(actor, "settings.manage");
  const files: Record<string, Uint8Array> = {};
  const counts: Record<string, number> = {};
  for (const s of SHEETS) {
    // row_to_json: o Postgres converte datas, json e números de um jeito só para todas as tabelas
    const rows = await prisma.$queryRawUnsafe<{ r: Record<string, unknown> }[]>(`SELECT row_to_json(x) AS r FROM (${s.sql}) x`, actor.restaurantId);
    const data = rows.map((x) => x.r);
    const keys = data.length ? Object.keys(data[0]).filter((k) => !SKIP.has(k)) : [];
    files[`${s.file}.csv`] = strToU8(toCsv(keys.map(header), data.map((row) => keys.map((k) => cell(k, row[k])))));
    counts[s.file] = data.length;
  }
  const day = todayIso();
  const readme = [
    "Exportação completa do Fechamento de Caixa",
    `Gerada em ${new Date().toISOString()} por ${actor.name} (${actor.email}).`,
    "",
    "Uma planilha (.csv) por assunto. Abre no Excel ou no Google Planilhas: separador ponto e vírgula, decimais com vírgula.",
    "Colunas terminadas em (R$) estão em reais. As ligações entre planilhas são feitas pelas colunas de id (por exemplo, sessionId liga a movimentação ao caixa).",
    "Senhas não são exportadas.",
    "",
    "Planilhas:",
    ...SHEETS.map((s) => `- ${s.file}.csv: ${s.title} (${counts[s.file]} linha(s))`),
  ].join("\r\n");
  files["LEIAME.txt"] = strToU8(readme);
  const zip = zipSync(files, { level: 6 });
  await audit(prisma, actor, { action: "export.full", entity: "restaurant", entityId: actor.restaurantId, newValue: { counts } });
  return { filename: `fechamento-dados-completos-${day}.zip`, zip, counts };
}
