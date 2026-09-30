import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REPORT_CSS, renderShiftReport } from "@/lib/reports/html";
import type { ShiftReportData } from "@/lib/reports/types";
import { Alert } from "@/components/ui";
import { PrintButton } from "@/components/small-client";
import { requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { listCorrections } from "@/server/services/queries";

export const metadata: Metadata = { title: "Relatório completo do fechamento" };

export default async function ClosingDetail({ params }: { params: Promise<{ closingId: string }> }) {
  const user = await requirePermission("history.view");
  const { closingId } = await params;
  const closing = await prisma.cashClosing.findFirst({
    where: { id: closingId, restaurantId: user.restaurantId },
    include: { session: { select: { id: true, status: true } } },
  });
  if (!closing) notFound();
  const data = closing.snapshot as unknown as ShiftReportData;
  const corrections = await listCorrections(prisma, user.restaurantId, closing.session.id);
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap gap-2">
        <PrintButton />
        <a className="btn-secondary" href={`/api/relatorio/turno/${closing.session.id}?baixar=1`}>Baixar (HTML)</a>
        <Link className="btn-secondary" href={`/caixa/${closing.session.id}/fechamento`}>Abrir o caixa</Link>
        <Link className="btn-secondary" href="/historico">Voltar ao histórico</Link>
      </div>
      {closing.session.status === "REOPENED" ? (
        <Alert tone="warn">Este caixa foi reaberto para correção. O relatório abaixo mostra os valores do último fechamento (revisão {closing.revision}).</Alert>
      ) : null}
      <style dangerouslySetInnerHTML={{ __html: REPORT_CSS }} />
      <div className="rounded-xl border border-stone-200 bg-white p-4 sm:p-8 print:border-0 print:p-0" dangerouslySetInnerHTML={{ __html: renderShiftReport(data, corrections) }} />
    </div>
  );
}
