import type { Metadata } from "next";
import Link from "next/link";
import { Alert } from "@/components/ui";
import { getSessionPage } from "@/server/session-page";
import { ConferenceForm } from "../conference-form";
import { ConferenceTable } from "../conference-table";
import { IfoodPanel } from "../ifood-panel";
import { ifoodShiftComparison } from "@/server/services/integrations";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Conferência de valores" };

export default async function ConferencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { bundle, editMode, actor } = await getSessionPage(id);
  const { evaluation: ev, session, settings } = bundle;
  const ifood = await ifoodShiftComparison(actor, id).catch(() => null);
  const ifoodPanel = ifood ? <IfoodPanel c={ifood} sessionId={id} canSync={Boolean(editMode) && can(actor.role, "conference.write")} /> : null;

  if (!editMode) {
    return (
      <div className="space-y-4">
        <Alert tone="info">Conferência concluída. Veja o fechamento na aba <Link className="link" href={`/caixa/${id}/fechamento`}>Fechamento</Link>.</Alert>
        {ifoodPanel}
        <ConferenceTable lines={ev.lines} cash={ev.summary.cash} divergence={ev.divergence} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ev.issues.length > 0 ? <Alert tone="error">{ev.issues.join(" ")}</Alert> : null}
      <p className="text-sm text-stone-600">
        Conferência de valores: compare o que o sistema registrou com o que a gaveta, as máquinas, o extrato de PIX e as plataformas mostram.
        Para fechar o caixa, vá para a aba <Link className="link" href={`/caixa/${id}/fechamento`}>Fechamento</Link>.
      </p>
      {ifoodPanel}
      <ConferenceForm
        sessionId={session.id}
        lines={ev.lines.map((l) => ({ key: l.key, group: l.group, label: l.label, fullLabel: l.fullLabel, systemCents: l.systemCents, expectedCents: l.expectedCents, checkedCents: l.checkedCents, required: l.required }))}
        cash={ev.summary.cash}
        toleranceCents={settings.toleranceCents}
        mode={editMode}
        showClose={false}
        initialJustification={session.closing?.justification ?? ""}
        initialNotes={session.closing?.notes ?? ""}
      />
      {ev.divergence.hints.length > 0 ? (
        <section className="card">
          <h2 className="card-title">Pistas sobre a origem da diferença</h2>
          <ul className="list-disc space-y-1 pl-5 text-sm">{ev.divergence.hints.map((h) => <li key={h}>{h}</li>)}</ul>
        </section>
      ) : null}
    </div>
  );
}
