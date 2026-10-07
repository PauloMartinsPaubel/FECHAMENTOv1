import type { Metadata } from "next";
import { formatTimeBR } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { MOVEMENT_TYPE_LABEL } from "@/lib/reports/labels";
import { Alert, Badge, Empty, Money, Stat } from "@/components/ui";
import { getSessionPage } from "@/server/session-page";
import { saleShortcuts } from "@/server/services/shortcuts";
import { CancellationForm, CatalogView, MovementActions, MovementForm, SaleForm } from "./forms";
import { SummaryStrip } from "./summary-strip";

export const metadata: Metadata = { title: "Lançamentos" };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, bundle, editMode } = await getSessionPage(id);
  const { session, movements, cancellations, evaluation: ev, catalogRows } = bundle;

  const catalog: CatalogView = {
    channels: catalogRows.channels.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name })),
    methods: catalogRows.methods.filter((m) => m.active).map((m) => ({ id: m.id, name: m.name, kind: m.kind })),
    brands: catalogRows.brands.filter((b) => b.active).map((b) => ({ id: b.id, name: b.name })),
  };
  const correction = editMode === "correction";
  const shortcuts = editMode ? await saleShortcuts(session.restaurantId, catalog).catch(() => []) : [];

  return (
    <div className="space-y-6">
      {ev.issues.length > 0 ? (
        <Alert tone="error">
          <strong>Inconsistências encontradas:</strong>
          <ul className="ml-5 mt-1 list-disc">{ev.issues.map((i) => <li key={i}>{i}</li>)}</ul>
        </Alert>
      ) : null}
      {session.status === "REOPENED" ? (
        <Alert tone="warn">Caixa reaberto para correção. Toda alteração exige motivo e fica registrada. Depois de corrigir, feche o caixa de novo na aba Fechamento.</Alert>
      ) : null}
      {!editMode && (session.status === "CLOSED" || session.status === "CORRECTED") ? (
        <Alert tone="info">Este caixa está fechado. Para corrigir algo, um gerente precisa reabri-lo na aba Fechamento, informando o motivo.</Alert>
      ) : null}

      {/* lançar venda vem primeiro: é o que a recepção faz o turno inteiro; o resumo fica logo abaixo */}
      {editMode ? (
        <section className="card">
          <h2 className="card-title">Lançar venda</h2>
          <SaleForm sessionId={session.id} catalog={catalog} correction={correction} shortcuts={shortcuts} />
          <p className="mt-3 text-xs text-stone-500">
            Para lançar vários valores de uma vez (totais por canal e forma), use a aba <strong>Canal x forma</strong>.
          </p>
        </section>
      ) : null}

      <SummaryStrip summary={ev.summary} />

      {editMode ? (
        <>

          <section className="card">
            <h2 className="card-title">Sangria, suprimento, despesa, estorno e ajuste</h2>
            <MovementForm sessionId={session.id} catalog={catalog} correction={correction} />
          </section>

          <details className="card">
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-stone-600">
              Registrar pedido cancelado que não foi lançado como venda
            </summary>
            <p className="mb-3 mt-2 text-sm text-stone-600">
              Se o pedido já está lançado como venda, não use este formulário: use <strong>Cancelar venda</strong> na própria venda, para ele sair do faturamento.
            </p>
            <CancellationForm sessionId={session.id} catalog={catalog} correction={correction} employeeName={user.name} />
          </details>
        </>
      ) : null}

      <section>
        <h2 className="card-title">Movimentações do caixa ({movements.length + 1})</h2>
        <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
          <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div>
              <strong>Fundo de abertura</strong>
              <div className="text-xs text-stone-500">Entra no dinheiro da gaveta. Não é faturamento.</div>
            </div>
            <div className="text-right">
              <Money cents={session.openingFloatCents} className="font-semibold" />
              <div className="mt-1 flex justify-end gap-1"><Badge kind="none">gaveta</Badge></div>
            </div>
          </li>
          {movements.length === 0 ? (
            <li className="px-4 py-6"><Empty>Nenhuma venda ou movimentação lançada ainda.</Empty></li>
          ) : null}
          {[...movements].reverse().map((m) => {
            const inactive = m.status !== "ACTIVE";
            return (
              <li key={m.id} className={`px-4 py-3 ${inactive ? "bg-stone-50 text-stone-500" : ""}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{MOVEMENT_TYPE_LABEL[m.type]}</strong>
                      {inactive ? <Badge kind={m.status}>{m.status === "VOIDED" ? "Anulado" : "Cancelado"}</Badge> : null}
                      <span className="text-xs text-stone-500">{formatTimeBR(m.occurredAt)}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-stone-600">
                      {[
                        m.channel?.name,
                        m.ticketBrand ? `${m.paymentMethod?.name} / ${m.ticketBrand.name}` : m.paymentMethod?.name,
                        m.orderNumber ? `pedido ${m.orderNumber}` : null,
                        m.description,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {m.voidReason ? <div className="text-xs text-stone-500">Motivo: {m.voidReason}</div> : null}
                    <div className="text-xs text-stone-400">por {m.createdBy.name}</div>
                  </div>
                  <div className="text-right">
                    <Money cents={m.amountCents} className={`font-semibold ${inactive ? "line-through" : ""}`} />
                    {!inactive ? (
                      <div className="mt-1 flex justify-end gap-1">
                        {m.revenueEffect !== 0 ? <Badge kind="CORRETO">{m.revenueEffect > 0 ? "+" : "-"} faturamento</Badge> : null}
                        {m.cashEffect !== 0 ? <Badge kind="none">{m.cashEffect > 0 ? "+" : "-"} gaveta</Badge> : null}
                      </div>
                    ) : null}
                  </div>
                </div>
                {editMode && !inactive ? (
                  <MovementActions
                    sessionId={session.id}
                    employeeName={user.name}
                    catalog={catalog}
                    m={{
                      id: m.id,
                      type: m.type,
                      status: m.status,
                      amountCents: m.amountCents,
                      channelId: m.channelId,
                      paymentMethodId: m.paymentMethodId,
                      ticketBrandId: m.ticketBrandId,
                      orderNumber: m.orderNumber,
                      description: m.description,
                      isAdjustment: m.type === "AJUSTE",
                    }}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      </section>

      {cancellations.length > 0 ? (
        <section>
          <h2 className="card-title">Pedidos cancelados ({cancellations.length}) · total {formatBRL(ev.summary.cancellationsCents)}</h2>
          <p className="mb-2 text-sm text-stone-600">Cancelamentos ficam guardados e não entram no faturamento.</p>
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {cancellations.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start justify-between gap-2 px-4 py-3 text-sm">
                <div>
                  <strong>Pedido {c.orderNumber}</strong> · {c.channel.name}
                  {c.paymentMethod ? ` · ${c.paymentMethod.name}` : ""}
                  <div className="text-stone-600">{c.reason} · {c.employeeName} · {formatTimeBR(c.occurredAt)}</div>
                  {c.movementId ? null : <div className="text-xs text-stone-500">Nunca foi lançado como venda (informativo).</div>}
                </div>
                <Money cents={c.amountCents} className="font-semibold" />
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
