import { formatBRL, formatSigned, KIND_LABEL } from "@/lib/finance";
import type { DayConsolidation, Headline } from "@/lib/finance";
import { formatDateBR, formatDateTimeBR, weekdayBR } from "@/lib/dates";
import { FLOAT_MODE_LABEL, MOVEMENT_TYPE_LABEL, SESSION_STATUS_LABEL, statusText } from "./labels";
import type { CorrectionLine, ShiftReportData } from "./types";

/** Escapa tudo que veio de digitação. Nenhum texto do usuário entra no HTML sem passar por aqui. */
export function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const REPORT_CSS = `
.rpt{font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#1c1917;font-size:14px;line-height:1.45;max-width:820px;margin:0 auto}
.rpt *{box-sizing:border-box}
.rpt h1{font-size:20px;letter-spacing:.04em;text-align:center;margin:0 0 4px;text-transform:uppercase}
.rpt h2{font-size:13px;letter-spacing:.08em;text-transform:uppercase;margin:22px 0 6px;padding-bottom:4px;border-bottom:2px solid #1c1917;color:#1c1917}
.rpt .sub{text-align:center;color:#57534e;margin:0 0 14px}
.rpt .meta{display:grid;grid-template-columns:repeat(2,1fr);gap:2px 24px;margin:10px 0 4px}
.rpt .meta div span{color:#57534e}
.rpt table{width:100%;border-collapse:collapse}
.rpt td,.rpt th{padding:4px 6px;vertical-align:top}
.rpt th{text-align:left;font-size:12px;color:#57534e;font-weight:600;border-bottom:1px solid #d6d3d1}
.rpt td.n,.rpt th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.rpt tr.row td{border-bottom:1px dotted #d6d3d1}
.rpt tr.total td{border-top:2px solid #1c1917;font-weight:700}
.rpt tr.subrow td{color:#57534e;font-size:13px}
.rpt .neg{color:#b91c1c}.rpt .pos{color:#a16207}.rpt .ok{color:#15803d}
.rpt .box{border:2px solid #1c1917;padding:10px 14px;margin:12px 0;border-radius:6px}
.rpt .box.ok{border-color:#15803d;background:#f0fdf4}.rpt .box.bad{border-color:#b91c1c;background:#fef2f2}.rpt .box.warn{border-color:#a16207;background:#fefce8}
.rpt .big{font-size:18px;font-weight:700}
.rpt .note{background:#f5f5f4;border-left:4px solid #78716c;padding:8px 12px;margin:8px 0;white-space:pre-wrap}
.rpt .banner{background:#fefce8;border:1px solid #a16207;color:#713f12;padding:8px 12px;border-radius:6px;margin:10px 0;font-weight:600}
.rpt .alert{background:#fef2f2;border:1px solid #b91c1c;color:#7f1d1d;padding:8px 12px;border-radius:6px;margin:10px 0}
.rpt .small{font-size:12px;color:#57534e}
.rpt .two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.rpt .foot{margin-top:24px;font-size:11px;color:#78716c;text-align:center}
@media print{.rpt{max-width:none;font-size:12px}.rpt .noprint{display:none!important}.rpt h2{break-after:avoid}.rpt table,.rpt .box{break-inside:avoid}}
@media (max-width:560px){.rpt .two,.rpt .meta{grid-template-columns:1fr}}
`;

const money = (c: number) => `<td class="n">${esc(formatBRL(c))}</td>`;
const diffCell = (c: number | null) =>
  c === null ? `<td class="n small">pendente</td>` : `<td class="n ${c < 0 ? "neg" : c > 0 ? "pos" : "ok"}">${esc(formatSigned(c))}</td>`;

function row(label: string, cents: number, cls = ""): string {
  return `<tr class="row ${cls}"><td>${esc(label)}</td>${money(cents)}</tr>`;
}

/** Relatório do turno no layout do pedido: abertura, vendas, movimentações, conferência e resultado. */
export function renderShiftReport(d: ShiftReportData, corrections: CorrectionLine[] = []): string {
  const s = d.session;
  const t = d.totals;
  const div = d.divergence;
  const cashLine = d.conference.find((l) => l.group === "CASH");
  const byGroup = (g: string) => d.conference.filter((l) => l.group === g && (l.systemCents !== 0 || l.expectedCents !== 0 || l.checkedCents !== null));
  const sum = (list: typeof d.conference, f: "systemCents" | "expectedCents") => list.reduce((a, l) => a + l[f], 0);
  const sumChecked = (list: typeof d.conference) => list.reduce((a, l) => a + (l.checkedCents ?? 0), 0);
  const sumDiff = (list: typeof d.conference) => list.reduce((a, l) => a + (l.differenceCents ?? 0), 0);

  const banner =
    s.status === "OPEN"
      ? `<div class="banner">PRÉVIA: o caixa ainda está aberto. Os números podem mudar até o fechamento.</div>`
      : s.status === "REOPENED"
        ? `<div class="banner">CAIXA REABERTO PARA CORREÇÃO: os números abaixo são os atuais e ainda não foram fechados de novo.</div>`
        : "";

  const conferenceBlock = (title: string, list: typeof d.conference) =>
    list.length === 0
      ? ""
      : `<h2>${esc(title)}</h2><table><tr><th>Item</th><th class="n">Sistema</th><th class="n">Conferido</th><th class="n">Diferença</th></tr>${list
          .map(
            (l) =>
              `<tr class="row"><td>${esc(l.label)}</td>${money(l.expectedCents)}${l.checkedCents === null ? `<td class="n small">não conferido</td>` : money(l.checkedCents)}${diffCell(l.differenceCents)}</tr>`,
          )
          .join("")}<tr class="total"><td>Total</td>${money(sum(list, "expectedCents"))}${money(sumChecked(list))}${diffCell(sumDiff(list))}</tr></table>`;

  const statusClass = div.status === "CORRETO" ? "ok" : div.status === null ? "warn" : "bad";
  const closingDate = s.closedAt ? formatDateTimeBR(s.closedAt) : null;

  const matrixRows = d.matrix
    .map((c) => {
      const cells = c.cells
        .map((x) => `<tr class="subrow"><td>&nbsp;&nbsp;${esc(x.brandName ? `${x.methodName} / ${x.brandName}` : x.methodName)}</td>${money(x.netCents)}</tr>`)
        .join("");
      return `<tr class="row"><td><strong>${esc(c.channelName)}</strong></td><td class="n"><strong>${esc(formatBRL(c.totalCents))}</strong></td></tr>${cells}`;
    })
    .join("");

  return `<div class="rpt">
<h1>Relatório de fechamento de caixa</h1>
<p class="sub">${esc(d.restaurantName)}</p>
${banner}
<div class="meta">
<div><span>Data:</span> <strong>${esc(formatDateBR(s.businessDate))}</strong> (${esc(weekdayBR(s.businessDate))})</div>
<div><span>Turno:</span> <strong>${esc(s.shiftName)}</strong></div>
<div><span>Caixa:</span> <strong>${esc(s.registerName)}</strong></div>
<div><span>Responsável:</span> <strong>${esc(s.responsibleName)}</strong></div>
<div><span>Situação:</span> ${esc(SESSION_STATUS_LABEL[s.status] ?? s.status)}${s.revision > 1 ? ` (revisão ${s.revision})` : ""}</div>
<div><span>Fechado por:</span> ${esc(s.closedByName ?? "-")}${closingDate ? ` em ${esc(closingDate)}` : ""}</div>
</div>

<h2>Abertura</h2>
<table>${row("Fundo inicial (não é faturamento)", d.floatCents)}
<tr class="subrow"><td colspan="2">${esc(FLOAT_MODE_LABEL[s.floatMode])}${s.transferredFromLabel ? `, vindo de ${esc(s.transferredFromLabel)}` : ""}</td></tr></table>

<h2>Vendas</h2>
<table>
${d.salesByKind
  .filter((k) => k.grossCents !== 0 || k.refundsCents !== 0 || k.adjustmentCents !== 0 || k.kind === "CASH")
  .map((k) => row(k.label, k.grossCents))
  .join("")}
<tr class="total"><td>Total de vendas (bruto)</td>${money(t.grossSalesCents)}</tr>
${t.refundsCents ? row("(-) Estornos", -t.refundsCents) : ""}
${t.revenueAdjustmentCents ? row("(+/-) Ajustes de faturamento", t.revenueAdjustmentCents) : ""}
<tr class="total"><td>FATURAMENTO</td>${money(t.revenueCents)}</tr>
</table>
<p class="small">Cartões (crédito + débito): ${esc(formatBRL(t.cardsCents))}. O fundo de caixa não faz parte do faturamento.</p>

<h2>Movimentações</h2>
<table>
${row("Sangrias", t.withdrawalsCents)}
${row("Suprimentos", t.suppliesCents)}
${row("Despesas", t.expensesTotalCents)}
${row(`Cancelamentos (${t.cancellationsCount})`, t.cancellationsCents)}
${row("Estornos", t.refundsCents)}
</table>

<h2>Dinheiro físico esperado</h2>
<table>
${row("Fundo de abertura", d.cash.floatCents)}
${row("(+) Vendas em dinheiro", d.cash.salesCents)}
${row("(+) Suprimentos", d.cash.suppliesCents)}
${row("(-) Sangrias", -d.cash.withdrawalsCents)}
${row("(-) Despesas pagas em dinheiro", -d.cash.expensesCents)}
${row("(-) Estornos em dinheiro", -d.cash.refundsCents)}
${d.cash.adjustmentsCents ? row("(+/-) Ajustes", d.cash.adjustmentsCents) : ""}
<tr class="total"><td>DINHEIRO ESPERADO</td>${money(d.cash.expectedCents)}</tr>
<tr class="row"><td>Dinheiro contado</td>${cashLine?.checkedCents == null ? `<td class="n small">não conferido</td>` : money(cashLine.checkedCents)}</tr>
<tr class="total"><td>Diferença de dinheiro</td>${diffCell(cashLine?.differenceCents ?? null)}</tr>
</table>

${conferenceBlock("Conferência de cartões", [...byGroup("CREDIT"), ...byGroup("DEBIT")])}
${conferenceBlock("Conferência de PIX", byGroup("PIX"))}
${conferenceBlock("Conferência de tickets", byGroup("TICKET"))}
${conferenceBlock("Conferência de pagamentos online (plataformas)", byGroup("ONLINE"))}
${conferenceBlock("Conferência de outros", byGroup("OTHER"))}

<h2>Resultado</h2>
<div class="box ${statusClass}">
<table>
<tr><td>Faturamento</td><td class="n big">${esc(formatBRL(t.revenueCents))}</td></tr>
<tr><td>Fundo inicial</td>${money(d.floatCents)}</tr>
<tr class="subrow"><td>Valores controlados (faturamento + fundo)</td>${money(t.controlledCents)}</tr>
<tr><td>Divergência total</td>${diffCell(div.status === null ? null : div.netCents)}</tr>
</table>
<p class="big" style="margin:8px 0 0">Status: ${esc(statusText(div.status, div.netCents, div.absCents))}</p>
</div>

${
  div.origins.length > 0
    ? `<h2>De onde veio a divergência</h2><table><tr><th>Origem</th><th class="n">Diferença</th></tr>${div.origins
        .map((o) => `<tr class="row"><td>${esc(o.label)}</td>${diffCell(o.differenceCents)}</tr>`)
        .join("")}<tr class="total"><td>Divergência líquida</td>${diffCell(div.netCents)}</tr><tr class="subrow"><td>Soma dos módulos</td>${money(div.absCents)}</tr></table>${
        div.hints.length
          ? `<p class="small"><strong>Pistas:</strong></p><ul class="small">${div.hints.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
          : ""
      }`
    : ""
}
${d.justification ? `<h2>Justificativa da divergência</h2><div class="note">${esc(d.justification)}</div>` : ""}
${d.notes ? `<h2>Observações</h2><div class="note">${esc(d.notes)}</div>` : ""}

<h2>Canal x forma de pagamento</h2>
${matrixRows ? `<table>${matrixRows}<tr class="total"><td>Faturamento</td>${money(t.revenueCents)}</tr></table>` : `<p class="small">Sem vendas lançadas.</p>`}

${
  d.ticketBrands.length
    ? `<h2>Tickets por bandeira</h2><table>${d.ticketBrands.map((b) => row(b.name, b.netCents)).join("")}<tr class="total"><td>Total de tickets</td>${money(d.ticketBrands.reduce((a, b) => a + b.netCents, 0))}</tr></table>`
    : ""
}

${
  d.cancellations.length
    ? `<h2>Pedidos cancelados</h2><table><tr><th>Pedido</th><th>Canal</th><th>Forma</th><th>Motivo</th><th>Funcionário</th><th class="n">Valor</th></tr>${d.cancellations
        .map(
          (c) =>
            `<tr class="row"><td>${esc(c.orderNumber)}</td><td>${esc(c.channelName)}</td><td>${esc(c.methodName ?? "-")}</td><td>${esc(c.reason)}${c.linkedToSale ? "" : ` <span class="small">(nunca lançado como venda)</span>`}</td><td>${esc(c.employeeName)}</td>${money(c.amountCents)}</tr>`,
        )
        .join("")}</table><p class="small">Cancelamentos não entram no faturamento.</p>`
    : ""
}

${
  d.movementLines.length
    ? `<h2>Movimentações detalhadas</h2><table><tr><th>Tipo</th><th>Descrição</th><th>Forma</th><th class="n">Valor</th><th>Afeta</th></tr>${d.movementLines
        .map(
          (m) =>
            `<tr class="row"><td>${esc(MOVEMENT_TYPE_LABEL[m.type] ?? m.type)}</td><td>${esc(m.description ?? "")}${m.orderNumber ? ` (pedido ${esc(m.orderNumber)})` : ""}</td><td>${esc(m.methodName ?? "")}</td>${money(m.amountCents)}<td class="small">${[m.revenueEffect ? "faturamento" : "", m.cashEffect ? "saldo físico" : ""].filter(Boolean).join(" e ") || "nenhum"}</td></tr>`,
        )
        .join("")}</table>`
    : ""
}

${
  corrections.length
    ? `<h2>Histórico de alterações</h2><table><tr><th>Quando</th><th>Quem</th><th>Campo</th><th>Antes</th><th>Depois</th><th>Motivo</th></tr>${corrections
        .map(
          (c) =>
            `<tr class="row"><td class="small">${esc(formatDateTimeBR(c.at))}</td><td>${esc(c.userName)}</td><td>${esc(c.field)}</td><td>${esc(c.oldValue ?? "-")}</td><td>${esc(c.newValue ?? "-")}</td><td>${esc(c.reason)}</td></tr>`,
        )
        .join("")}</table>`
    : `<p class="small">Este fechamento não foi alterado depois de concluído.</p>`
}
${d.integrityIssues.length ? `<div class="alert"><strong>Inconsistências encontradas:</strong><ul>${d.integrityIssues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>` : ""}
<p class="foot">Gerado em ${esc(formatDateTimeBR(d.generatedAt))}. Valores em reais. Fundo de caixa nunca é contado como faturamento.</p>
</div>`;
}

export interface DayReportData {
  businessDate: string;
  restaurantName: string;
  generatedAt: string;
  openSessions: number;
  sessions: {
    sessionId: string;
    shiftName: string;
    registerName: string;
    responsibleName: string;
    status: string;
    floatCents: number;
    floatMode: string;
    headline: Headline;
    diffStatus: string | null;
    closingStatusText: string;
  }[];
  consolidation: DayConsolidation;
}

function shiftColumn(title: string, h: Headline, floatText: string): string {
  return `<div><table><tr><th colspan="2">${esc(title)}</th></tr>
${row("Faturamento", h.revenueCents)}${row("Dinheiro", h.cashSalesCents)}${row("Cartões", h.cardsCents)}${row("PIX", h.pixCents)}${row("Tickets", h.ticketsCents)}${row("Online", h.onlineCents)}${row("Outros", h.otherCents)}
<tr class="row"><td>Divergência</td>${diffCell(h.divergenceNetCents)}</tr>
<tr class="subrow"><td colspan="2">${esc(floatText)}</td></tr></table></div>`;
}

/** Fechamento geral do dia: manhã, tarde/noite e total, sem duplicar fundo. */
export function renderDayReport(d: DayReportData): string {
  const c = d.consolidation;
  const t = c.total;
  const banner = d.openSessions
    ? `<div class="banner">${d.openSessions} caixa(s) ainda aberto(s) ou em correção: o total do dia é parcial.</div>`
    : "";
  return `<div class="rpt">
<h1>Fechamento geral do dia</h1>
<p class="sub">${esc(d.restaurantName)} · ${esc(formatDateBR(d.businessDate))} (${esc(weekdayBR(d.businessDate))})</p>
${banner}
${c.shifts.length === 0 ? `<p>Nenhum caixa aberto neste dia.</p>` : ""}
<div class="two">
${c.shifts
  .map((b) => shiftColumn(b.shiftName, b.headline, `Fundo: ${formatBRL(b.newFloatCents + b.transferredFloatCents)}${b.transferredFloatCents ? " (transferido do turno anterior)" : ""}`))
  .join("")}
</div>

<h2>Total do dia</h2>
<table>
${row("Faturamento total", t.revenueCents, "total")}
${row("Dinheiro total", t.cashSalesCents)}
${row("Cartões total", t.cardsCents)}
${row("   Crédito", t.creditCents, "subrow")}
${row("   Débito", t.debitCents, "subrow")}
${row("PIX total", t.pixCents)}
${row("Tickets total", t.ticketsCents)}
${row("Online total", t.onlineCents)}
${row("Outros", t.otherCents)}
${row("Cancelamentos", t.cancellationsCents)}
${row("Estornos", t.refundsCents)}
${row("Sangrias", t.withdrawalsCents)}
${row("Suprimentos", t.suppliesCents)}
${row("Despesas", t.expensesCents)}
<tr class="row"><td>Divergência líquida</td>${diffCell(t.divergenceNetCents)}</tr>
<tr class="subrow"><td>Soma dos módulos das diferenças</td>${money(t.divergenceAbsCents)}</tr>
</table>

<h2>Fundo de caixa</h2>
<table>
${c.floatLines
  .map(
    (f) =>
      `<tr class="row"><td>Fundo ${esc(f.shiftName)} (${esc(f.registerName)})${f.countsAsNewEntry ? "" : ` <span class="small">transferido, não soma de novo</span>`}</td>${money(f.floatCents)}</tr>`,
  )
  .join("")}
<tr class="total"><td>Fundo contado como entrada nova</td>${money(c.floatCents)}</tr>
<tr class="subrow"><td>Valores controlados (faturamento + fundo)</td>${money(c.controlledCents)}</tr>
</table>
<p class="small">O fundo de caixa não é faturamento. Se o mesmo fundo passa de um turno para o outro, ele aparece nos dois turnos, mas entra uma vez só na soma.</p>

<h2>Caixas do dia</h2>
<table><tr><th>Turno</th><th>Caixa</th><th>Responsável</th><th>Situação</th><th class="n">Faturamento</th><th>Resultado</th></tr>
${d.sessions
  .map(
    (s) =>
      `<tr class="row"><td>${esc(s.shiftName)}</td><td>${esc(s.registerName)}</td><td>${esc(s.responsibleName)}</td><td>${esc(SESSION_STATUS_LABEL[s.status] ?? s.status)}</td>${money(s.headline.revenueCents)}<td>${esc(s.closingStatusText)}</td></tr>`,
  )
  .join("")}
</table>
<p class="foot">Gerado em ${esc(formatDateTimeBR(d.generatedAt))}.</p>
</div>`;
}

/** Documento completo para impressão, PDF e anexo de e-mail. */
export function wrapDocument(title: string, body: string): string {
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>body{margin:0;padding:24px;background:#fff}${REPORT_CSS}</style></head>
<body>${body}</body></html>`;
}

export { KIND_LABEL };
