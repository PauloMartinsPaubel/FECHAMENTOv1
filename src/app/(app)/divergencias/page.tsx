import type { Metadata } from "next";
import Link from "next/link";
import { formatDateBR, isIsoDate, todayIso } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { statusShort } from "@/lib/reports/labels";
import { Alert, Badge, Diff, Empty, PageHeader, Stat } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { ServiceError } from "@/server/errors";
import { buildPeriodReport, presetRange } from "@/server/services/queries";

export const metadata: Metadata = { title: "Divergências" };

export default async function DivergencesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const def = presetRange("30dias");
  const from = isIsoDate(sp.from) ? sp.from : def.from;
  const to = isIsoDate(sp.to) ? sp.to : def.to;
  let report = null;
  let error: string | null = null;
  try {
    report = await buildPeriodReport({ ...user, ip: await clientIp() }, { from, to });
  } catch (err) {
    error = err instanceof ServiceError ? err.message : "Não foi possível carregar.";
  }
  const falta = report?.divergences.reduce((a, d) => a + d.origins.filter((o) => o.differenceCents < 0).reduce((x, o) => x + o.differenceCents, 0), 0) ?? 0;
  const sobra = report?.divergences.reduce((a, d) => a + d.origins.filter((o) => o.differenceCents > 0).reduce((x, o) => x + o.differenceCents, 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Divergências" subtitle="Cada diferença com a sua origem, o responsável e a justificativa." actions={<a className="btn-secondary" href={`/api/export/divergencias?from=${from}&to=${to}`}>Exportar CSV</a>} />
      <form method="get" className="card no-print flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="from">De</label><input id="from" name="from" type="date" defaultValue={from} max={todayIso()} className="input" /></div>
        <div><label className="label" htmlFor="to">Até</label><input id="to" name="to" type="date" defaultValue={to} max={todayIso()} className="input" /></div>
        <button className="btn-primary" type="submit">Filtrar</button>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {report ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Caixas com diferença" value={report.divergences.length} hint={`de ${report.sessionCount} fechado(s)`} tone={report.divergences.length ? "bad" : "good"} />
            <Stat label="Faltas" value={<Diff cents={falta} />} />
            <Stat label="Sobras" value={<Diff cents={sobra} />} />
          </div>
          {report.divergences.length === 0 ? <Empty>Nenhuma divergência no período. Todos os caixas fechados bateram.</Empty> : (
            <div className="space-y-3">
              {report.divergences.map((d) => (
                <article key={d.sessionId} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <Link className="link text-base font-bold" href={`/caixa/${d.sessionId}/fechamento`}>{formatDateBR(d.date)} · {d.shiftName}</Link>
                      <span className="ml-2 text-sm text-stone-600">{d.registerName} · {d.responsibleName}</span>
                    </div>
                    <div><Badge kind={d.status ?? "none"}>{statusShort(d.status as never)}</Badge> <Diff cents={d.netCents} /> <span className="text-xs text-stone-500">(soma {formatBRL(d.absCents)})</span></div>
                  </div>
                  <ul className="mt-2 text-sm">{d.origins.map((o) => <li key={o.label} className="flex justify-between border-b border-stone-100 py-1"><span>{o.label}</span><Diff cents={o.differenceCents} /></li>)}</ul>
                  <p className="mt-2 text-sm text-stone-700"><strong>Justificativa:</strong> {d.justification ?? <span className="text-stone-400">não informada (dentro da tolerância)</span>}</p>
                </article>
              ))}
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
