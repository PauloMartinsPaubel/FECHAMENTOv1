import type { Metadata } from "next";
import Link from "next/link";
import { PrintButton } from "@/components/small-client";
import { REPORT_CSS, renderShiftReport } from "@/lib/reports/html";
import { loadShiftReport } from "@/server/reports/shift-report";
import { getSessionPage } from "@/server/session-page";

export const metadata: Metadata = { title: "Relatório do turno" };

export default async function ShiftReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor } = await getSessionPage(id);
  const { data, corrections } = await loadShiftReport(actor, id);
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <PrintButton />
        <a className="btn-secondary" href={`/api/relatorio/turno/${id}?baixar=1`}>Baixar (HTML)</a>
        <a className="btn-secondary" href={`/api/export/movimentacoes?sessionId=${id}`}>Exportar movimentações (CSV)</a>
        <a className="btn-secondary" href={`/api/export/conferencia?sessionId=${id}`}>Exportar conferência (CSV)</a>
        <Link className="btn-secondary" href={`/caixa/${id}/fechamento`}>Voltar ao fechamento</Link>
      </div>
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-8 print:border-0 print:p-0" dangerouslySetInnerHTML={{ __html: renderShiftReport(data, corrections) }} />
    </div>
  );
}
