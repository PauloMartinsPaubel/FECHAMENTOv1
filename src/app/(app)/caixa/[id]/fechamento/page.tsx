import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTimeBR } from "@/lib/dates";
import { formatBRL, formatDecimalComma } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { statusText } from "@/lib/reports/labels";
import type { ShiftReportData } from "@/lib/reports/types";
import { Alert, Badge, Diff, Stat } from "@/components/ui";
import { prisma } from "@/server/db";
import { listCorrections } from "@/server/services/queries";
import { getSessionPage } from "@/server/session-page";
import { ConferenceForm } from "../conference-form";
import { ConferenceTable } from "../conference-table";
import { EmailPanel, FloatPanel, ReopenPanel } from "../panels";

export const metadata: Metadata = { title: "Fechamento de caixa" };

const EXPORTS: [string, string][] = [
  ["fechamento", "Fechamento"],
  ["vendas", "Vendas"],
  ["movimentacoes", "Movimentações"],
  ["conferencia", "Conferência"],
  ["dinheiro", "Dinheiro"],
  ["cartoes", "Cartões"],
  ["pix", "PIX"],
  ["tickets", "Tickets"],
  ["cancelamentos", "Cancelamentos"],
  ["divergencias", "Divergências"],
];

export default async function ClosingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ fechado?: string }> }) {
  const { id } = await params;
  const { fechado } = await searchParams;
  const { user, bundle, editMode } = await getSessionPage(id);
  const { session, evaluation: ev, settings } = bundle;
  const closing = session.closing;
  const isClosed = (session.status === "CLOSED" || session.status === "CORRECTED") && closing;
  const snap = isClosed ? (closing.snapshot as unknown as ShiftReportData) : null;

  const s = ev.summary;
  const divergenceNet = snap ? snap.divergence.netCents : ev.divergence.status === null ? null : ev.divergence.netCents;

  const [emails, corrections] = await Promise.all([
    prisma.emailLog.findMany({ where: { sessionId: id }, orderBy: { attempt: "desc" }, include: { createdBy: { select: { name: true } } } }),
    isClosed ? listCorrections(prisma, user.restaurantId, id) : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-5">
      {fechado ? (
        <Alert tone="ok">
          <strong>Caixa fechado e salvo.</strong> Agora você pode gerar o relatório, exportar o CSV e enviar por e-mail. O envio é uma etapa separada e não altera o fechamento.
        </Alert>
      ) : null}

      <section aria-label="Resumo do fechamento" className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Faturamento" value={formatBRL(snap ? snap.totals.revenueCents : s.revenueCents)} hint="Sem o fundo" tone="good" />
        <Stat label="Fundo" value={formatBRL(s.floatCents)} hint="Não é faturamento" />
        <Stat label="Sangrias" value={formatBRL(s.withdrawalsCents)} />
        <Stat label="Cancelamentos" value={formatBRL(s.cancellationsCents)} hint={`${s.cancellationsCount} pedido(s)`} />
        <Stat
          label="Divergência"
          value={divergenceNet === null ? "pendente" : <Diff cents={divergenceNet} />}
          tone={divergenceNet === null ? "default" : divergenceNet === 0 ? "good" : "bad"}
        />
      </section>
      <p className="text-xs text-stone-500">
        Valores controlados (faturamento + fundo): {formatBRL(s.controlledCents)}. Esse total nunca é chamado de faturamento.
      </p>

      {ev.issues.length > 0 ? (
        <Alert tone="error">
          <strong>Este caixa tem inconsistências e não pode ser fechado:</strong>
          <ul className="ml-5 mt-1 list-disc">{ev.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </Alert>
      ) : null}

      {!isClosed ? (
        <>
          {session.status === "REOPENED" ? (
            <Alert tone="warn">
              Caixa reaberto para correção. Corrija o que for preciso nas abas Lançamentos e Conferência, confira os valores abaixo e feche de novo informando o que foi corrigido.
            </Alert>
          ) : null}
          {editMode ? (
            <ConferenceForm
              sessionId={session.id}
              lines={ev.lines.map((l) => ({ key: l.key, group: l.group, label: l.label, fullLabel: l.fullLabel, systemCents: l.systemCents, expectedCents: l.expectedCents, checkedCents: l.checkedCents, required: l.required }))}
              cash={ev.summary.cash}
              toleranceCents={settings.toleranceCents}
              mode={editMode}
              showClose
              initialJustification={closing?.justification ?? ""}
              initialNotes={closing?.notes ?? ""}
            />
          ) : (
            <Alert tone="info">Este caixa está em correção por um gerente. Só gerente ou administrador consegue concluir.</Alert>
          )}
          {can(user.role, "closing.correct") ? (
            <section className="card">
              <h2 className="card-title">Corrigir fundo de abertura</h2>
              <FloatPanel sessionId={session.id} currentFloat={formatDecimalComma(session.openingFloatCents)} />
            </section>
          ) : null}
        </>
      ) : snap ? (
        <>
          <section className={`card border-2 ${snap.divergence.status === "CORRETO" ? "border-green-500" : "border-red-400"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold">{statusText(snap.divergence.status, snap.divergence.netCents, snap.divergence.absCents)}</h2>
              <div className="flex items-center gap-2 text-sm text-stone-600">
                <Badge kind={session.status}>{session.status === "CORRECTED" ? "Fechado após correção" : "Fechado"}</Badge>
                revisão {closing.revision} · por {snap.session.closedByName} em {snap.session.closedAt ? formatDateTimeBR(snap.session.closedAt) : ""}
              </div>
            </div>
            {snap.justification ? <p className="mt-3 rounded-lg bg-stone-50 p-3 text-sm"><strong>Justificativa:</strong> {snap.justification}</p> : null}
            {snap.notes ? <p className="mt-2 rounded-lg bg-stone-50 p-3 text-sm"><strong>Observação:</strong> {snap.notes}</p> : null}
            <div className="no-print mt-4 flex flex-wrap gap-2">
              <Link className="btn-primary" href={`/caixa/${id}/relatorio`}>Gerar relatório</Link>
              <a className="btn-secondary" href={`/api/relatorio/turno/${id}?baixar=1`}>Baixar relatório (HTML)</a>
              <details className="relative">
                <summary className="btn-secondary cursor-pointer list-none">Exportar CSV</summary>
                <ul className="absolute left-0 z-10 mt-1 w-48 rounded-lg border border-stone-200 bg-white p-1 shadow-lg">
                  {EXPORTS.map(([k, label]) => (
                    <li key={k}><a className="block rounded px-3 py-2 text-sm hover:bg-stone-100" href={`/api/export/${k}?sessionId=${id}`}>{label}</a></li>
                  ))}
                </ul>
              </details>
            </div>
          </section>

          <ConferenceTable lines={snap.conference} cash={snap.cash} divergence={snap.divergence} />

          <section className="card">
            <h2 className="card-title">Enviar relatório ao responsável</h2>
            <EmailPanel
              sessionId={id}
              defaultRecipients={settings.closingRecipients.join(", ")}
              hasPrevious={emails.length > 0}
              lastFailed={emails[0]?.status === "FAILED"}
            />
            {emails.length > 0 ? (
              <ul className="mt-4 divide-y divide-stone-100 text-sm">
                {emails.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                    <div>
                      <div>Tentativa {e.attempt} para {e.toEmails.join(", ")}</div>
                      <div className="text-xs text-stone-500">{formatDateTimeBR(e.createdAt)}{e.createdBy ? ` por ${e.createdBy.name}` : ""}</div>
                      {e.error ? <div className="text-xs text-red-700">{e.error}</div> : null}
                    </div>
                    <Badge kind={e.status}>{e.status === "SENT" ? "Enviado" : e.status === "FAILED" ? "Falhou" : "Pendente"}</Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          {corrections.length > 0 ? (
            <section className="card">
              <h2 className="card-title">Histórico de alterações deste fechamento</h2>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr><th className="th">Quando</th><th className="th">Quem</th><th className="th">Campo</th><th className="th">Antes</th><th className="th">Depois</th><th className="th">Motivo</th></tr></thead>
                  <tbody className="divide-y divide-stone-100">
                    {corrections.map((c, i) => (
                      <tr key={i}><td className="td text-xs">{formatDateTimeBR(c.at)}</td><td className="td">{c.userName}</td><td className="td">{c.field}</td><td className="td">{c.oldValue ?? "-"}</td><td className="td">{c.newValue ?? "-"}</td><td className="td">{c.reason}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : (
            <p className="text-sm text-stone-500">Este fechamento não foi alterado depois de concluído.</p>
          )}

          {can(user.role, "closing.reopen") ? (
            <section className="card">
              <h2 className="card-title">Reabrir para correção</h2>
              <ReopenPanel sessionId={id} />
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
