import type { Metadata } from "next";
import Link from "next/link";
import { formatDateBR, isIsoDate, todayIso } from "@/lib/dates";
import { formatBRL, KIND_LABEL, PAYMENT_KINDS } from "@/lib/finance";
import { statusShort } from "@/lib/reports/labels";
import { PrintButton } from "@/components/small-client";
import { Alert, Badge, Diff, Empty, PageHeader, Stat } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { loadCatalogRows } from "@/server/loaders";
import { buildPeriodReport, presetRange, type BreakdownRow, type PeriodReport } from "@/server/services/queries";

export const metadata: Metadata = { title: "Relatórios" };

type SP = Record<string, string | undefined>;
const PRESETS: [string, string][] = [["hoje", "Hoje"], ["ontem", "Ontem"], ["semana", "Esta semana"], ["7dias", "7 dias"], ["mes", "Este mês"], ["30dias", "30 dias"]];
const EXPORTS: [string, string][] = [
  ["fechamento", "Fechamentos"], ["vendas", "Vendas"], ["movimentacoes", "Movimentações"], ["conferencia", "Conferência"],
  ["dinheiro", "Dinheiro"], ["cartoes", "Cartões"], ["pix", "PIX"], ["tickets", "Tickets"], ["cancelamentos", "Cancelamentos"], ["divergencias", "Divergências"],
];

export default async function ReportsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const today = todayIso();
  const preset = sp.preset && PRESETS.some(([k]) => k === sp.preset) ? sp.preset : null;
  const range = preset ? presetRange(preset, today) : { from: isIsoDate(sp.from) ? sp.from : today, to: isIsoDate(sp.to) ? sp.to : today };

  const filters = {
    ...range,
    shiftId: sp.shiftId || undefined,
    registerId: sp.registerId || undefined,
    responsibleId: sp.responsibleId || undefined,
    channelId: sp.channelId || undefined,
    paymentMethodId: sp.paymentMethodId || undefined,
    includeOpen: sp.includeOpen === "1",
  };

  const [catalog, users] = await Promise.all([
    loadCatalogRows(prisma, user.restaurantId),
    prisma.user.findMany({ where: { restaurantId: user.restaurantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);

  let report: PeriodReport | null = null;
  let error: string | null = null;
  try {
    report = await buildPeriodReport({ ...user, ip: await clientIp() }, filters);
  } catch (err) {
    error = err instanceof ServiceError ? err.message : "Não foi possível gerar o relatório.";
  }

  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries({ from: filters.from, to: filters.to, shiftId: filters.shiftId, registerId: filters.registerId, responsibleId: filters.responsibleId, includeOpen: filters.includeOpen ? "1" : undefined })) {
    if (v) qs.set(k, v);
  }

  const t = report?.totals;
  return (
    <div className="space-y-6">
      <PageHeader title="Relatórios" subtitle={`${formatDateBR(range.from)} a ${formatDateBR(range.to)}`} actions={<PrintButton label="Imprimir / PDF" />} />

      <form method="get" className="card no-print space-y-3">
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(([k, label]) => (
            <Link key={k} href={`/relatorios?preset=${k}`} className={preset === k ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>{label}</Link>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div><label className="label" htmlFor="from">De</label><input id="from" name="from" type="date" defaultValue={range.from} max={today} className="input" /></div>
          <div><label className="label" htmlFor="to">Até</label><input id="to" name="to" type="date" defaultValue={range.to} max={today} className="input" /></div>
          <div><label className="label" htmlFor="shiftId">Turno</label>
            <select id="shiftId" name="shiftId" defaultValue={filters.shiftId ?? ""} className="input"><option value="">Todos</option>{catalog.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label" htmlFor="registerId">Caixa</label>
            <select id="registerId" name="registerId" defaultValue={filters.registerId ?? ""} className="input"><option value="">Todos</option>{catalog.registers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label" htmlFor="responsibleId">Funcionário</label>
            <select id="responsibleId" name="responsibleId" defaultValue={filters.responsibleId ?? ""} className="input"><option value="">Todos</option>{users.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label" htmlFor="channelId">Plataforma / canal</label>
            <select id="channelId" name="channelId" defaultValue={filters.channelId ?? ""} className="input"><option value="">Todos</option>{catalog.channels.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <div><label className="label" htmlFor="paymentMethodId">Forma de pagamento</label>
            <select id="paymentMethodId" name="paymentMethodId" defaultValue={filters.paymentMethodId ?? ""} className="input"><option value="">Todas</option>{catalog.methods.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
          <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" name="includeOpen" value="1" defaultChecked={filters.includeOpen} /> Incluir caixas ainda abertos</label>
        </div>
        <button type="submit" className="btn-primary">Gerar relatório</button>
      </form>

      {error ? <Alert tone="error">{error}</Alert> : null}

      {report && t ? (
        <>
          {report.scoped ? <Alert tone="info">Filtro de canal ou forma ativo: os valores de faturamento abaixo são só do que pertence ao filtro. Sangrias, despesas, fundo e diferenças não se separam por canal e ficam zerados.</Alert> : null}
          {report.openCount > 0 ? <Alert tone="warn">{report.openCount} caixa(s) ainda aberto(s) ou em correção entram no período: valores parciais.</Alert> : null}
          {report.sessionCount === 0 ? <Empty>Nenhum caixa fechado neste período com esses filtros.</Empty> : null}

          <section aria-label="Indicadores" className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label="Faturamento" value={formatBRL(t.revenueCents)} hint={`${report.sessionCount} caixa(s). Sem o fundo.`} tone="good" />
              <Stat label="Fundo (entradas novas)" value={formatBRL(report.floatCents)} hint={report.transferredFloatCents ? `${formatBRL(report.transferredFloatCents)} transferido entre turnos, não somado` : "Não é faturamento"} />
              <Stat label="Valores controlados" value={formatBRL(report.controlledCents)} hint="Faturamento + fundo" />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
              <Stat label="Dinheiro" value={formatBRL(t.cashSalesCents)} />
              <Stat label="Crédito" value={formatBRL(t.creditCents)} />
              <Stat label="Débito" value={formatBRL(t.debitCents)} />
              <Stat label="Total cartões" value={formatBRL(t.cardsCents)} />
              <Stat label="PIX" value={formatBRL(t.pixCents)} />
              <Stat label="Tickets" value={formatBRL(t.ticketsCents)} />
              <Stat label="Online" value={formatBRL(t.onlineCents)} />
              <Stat label="Cancelamentos" value={formatBRL(t.cancellationsCents)} hint={`${t.cancellationsCount} pedido(s)`} />
              <Stat label="Estornos" value={formatBRL(t.refundsCents)} />
              <Stat label="Sangrias" value={formatBRL(t.withdrawalsCents)} />
              <Stat label="Despesas" value={formatBRL(t.expensesCents)} />
              <Stat label="Diferenças" value={<Diff cents={t.divergenceNetCents} />} hint={`Soma dos módulos ${formatBRL(t.divergenceAbsCents)}`} tone={t.divergenceAbsCents > 0 ? "bad" : "good"} />
            </div>
          </section>

          <Breakdown title="Por dia" rows={report.byDay} dateLabels />
          <Breakdown title="Por turno" rows={report.byShift} />
          <Breakdown title="Por funcionário" rows={report.byEmployee} />
          <Breakdown title="Por caixa" rows={report.byRegister} />

          <section className="card">
            <h2 className="card-title">Por plataforma / canal e forma de pagamento</h2>
            {report.byChannel.length === 0 ? <Empty>Sem vendas.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead><tr className="border-b border-stone-300"><th className="th">Canal</th>{PAYMENT_KINDS.map((k) => <th key={k} className="th text-right">{KIND_LABEL[k]}</th>)}<th className="th text-right">Total</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {report.byChannel.map((c) => (
                      <tr key={c.channelId}>
                        <th scope="row" className="td text-left font-medium">{c.name}{c.isPlatform ? <span className="ml-1 text-xs text-stone-400">plataforma</span> : null}</th>
                        {PAYMENT_KINDS.map((k) => <td key={k} className="td num">{c.byKind[k] ? formatBRL(c.byKind[k]) : <span className="text-stone-300">-</span>}</td>)}
                        <td className="td num font-semibold">{formatBRL(c.netCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="border-t-2 border-stone-400 font-bold"><th scope="row" className="td text-left">Total</th>{report.byKind.map((k) => <td key={k.kind} className="td num">{formatBRL(k.netCents)}</td>)}<td className="td num">{formatBRL(t.revenueCents)}</td></tr></tfoot>
                </table>
              </div>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">Por forma de pagamento</h2>
            {report.byMethod.length === 0 ? <Empty>Sem vendas.</Empty> : (
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-300"><th className="th">Forma</th><th className="th text-right">Vendas</th><th className="th text-right">Estornos</th><th className="th text-right">Líquido</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {report.byMethod.map((m) => <tr key={m.key}><td className="td">{m.label}</td><td className="td num">{formatBRL(m.grossCents)}</td><td className="td num">{m.refundsCents ? formatBRL(-m.refundsCents) : "-"}</td><td className="td num font-semibold">{formatBRL(m.netCents)}</td></tr>)}
                </tbody>
              </table>
            )}
          </section>

          <section className="card">
            <h2 className="card-title">Divergências do período ({report.divergences.length})</h2>
            {report.divergences.length === 0 ? <Empty>Nenhum caixa fechado com diferença neste período.</Empty> : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="border-b border-stone-300"><th className="th">Data</th><th className="th">Turno</th><th className="th">Responsável</th><th className="th">De onde veio</th><th className="th text-right">Diferença</th><th className="th">Justificativa</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {report.divergences.map((d) => (
                      <tr key={d.sessionId}>
                        <td className="td"><Link className="link" href={`/caixa/${d.sessionId}/fechamento`}>{formatDateBR(d.date)}</Link></td>
                        <td className="td">{d.shiftName} <span className="text-xs text-stone-500">{d.registerName}</span></td>
                        <td className="td">{d.responsibleName}</td>
                        <td className="td">{d.origins.map((o) => <div key={o.label}>{o.label}: <Diff cents={o.differenceCents} /></div>)}</td>
                        <td className="td num"><Badge kind={d.status ?? "none"}>{statusShort(d.status as never)}</Badge> <Diff cents={d.netCents} /></td>
                        <td className="td text-stone-600">{d.justification ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card no-print">
            <h2 className="card-title">Exportar CSV (com os filtros de período, turno, caixa e funcionário)</h2>
            <div className="flex flex-wrap gap-2">
              {EXPORTS.map(([k, label]) => <a key={k} className="btn-secondary btn-sm" href={`/api/export/${k}?${qs.toString()}`}>{label}</a>)}
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

function Breakdown({ title, rows, dateLabels }: { title: string; rows: BreakdownRow[]; dateLabels?: boolean }) {
  if (rows.length === 0) return null;
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-stone-300">
              <th className="th">{title.replace("Por ", "")}</th><th className="th text-right">Caixas</th><th className="th text-right">Faturamento</th><th className="th text-right">Dinheiro</th>
              <th className="th text-right">Cartões</th><th className="th text-right">PIX</th><th className="th text-right">Tickets</th><th className="th text-right">Online</th><th className="th text-right">Diferença</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="td font-medium">{dateLabels ? formatDateBR(r.label) : r.label}</td>
                <td className="td num">{r.sessionCount}</td>
                <td className="td num font-semibold">{formatBRL(r.headline.revenueCents)}</td>
                <td className="td num">{formatBRL(r.headline.cashSalesCents)}</td>
                <td className="td num">{formatBRL(r.headline.cardsCents)}</td>
                <td className="td num">{formatBRL(r.headline.pixCents)}</td>
                <td className="td num">{formatBRL(r.headline.ticketsCents)}</td>
                <td className="td num">{formatBRL(r.headline.onlineCents)}</td>
                <td className="td num"><Diff cents={r.headline.divergenceNetCents} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
