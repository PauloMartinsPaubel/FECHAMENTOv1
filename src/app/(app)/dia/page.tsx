import type { Metadata } from "next";
import { addDays, isIsoDate, todayIso } from "@/lib/dates";
import { REPORT_CSS, renderDayReport } from "@/lib/reports/html";
import { PrintButton } from "@/components/small-client";
import { Alert, PageHeader } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { buildDayReport } from "@/server/services/queries";

export const metadata: Metadata = { title: "Fechamento geral do dia" };

export default async function DayPage({ searchParams }: { searchParams: Promise<{ data?: string }> }) {
  const user = await requirePermission("reports.view");
  const { data } = await searchParams;
  const date = isIsoDate(data) ? data : todayIso();
  const report = await buildDayReport({ ...user, ip: await clientIp() }, date);
  return (
    <div>
      <PageHeader
        title="Fechamento geral do dia"
        subtitle="Manhã, tarde/noite e total, sem duplicar o fundo de caixa."
        actions={
          <>
            <a className="btn-secondary" href={`/api/relatorio/dia?data=${date}`} target="_blank" rel="noreferrer">Abrir para imprimir</a>
            <PrintButton />
          </>
        }
      />
      <form method="get" className="no-print mb-4 flex flex-wrap items-end gap-2">
        <div>
          <label htmlFor="data" className="label">Dia</label>
          <input id="data" name="data" type="date" defaultValue={date} max={todayIso()} className="input" />
        </div>
        <button className="btn-primary" type="submit">Ver</button>
        <a className="btn-secondary" href={`/dia?data=${addDays(date, -1)}`}>Dia anterior</a>
        {date < todayIso() ? <a className="btn-secondary" href={`/dia?data=${addDays(date, 1)}`}>Próximo dia</a> : null}
      </form>
      {report.sessions.length === 0 ? <Alert tone="info">Nenhum caixa foi aberto neste dia.</Alert> : null}
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-8 print:border-0 print:p-0" dangerouslySetInnerHTML={{ __html: renderDayReport(report) }} />
    </div>
  );
}
