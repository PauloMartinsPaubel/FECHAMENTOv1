import { formatDateTimeBR, formatTimeBR } from "@/lib/dates";
import { formatBRL, KIND_LABEL, type PaymentKind } from "@/lib/finance";
import { Diff } from "@/components/ui";
import { IfoodSyncButton } from "@/components/ifood-sync-button";
import { IfoodAutoSync } from "@/components/ifood-auto-sync";
import { IfoodReportUpload } from "@/components/ifood-report-upload";
import type { IfoodShiftComparison } from "@/server/services/integrations";

/** Painel na Conferência: o que o iFood registrou neste turno x o que foi lançado no caixa. */
export function IfoodPanel({ c, sessionId, canSync, apiConfigured }: { c: IfoodShiftComparison; sessionId: string; canSync: boolean; apiConfigured: boolean }) {
  const offline = Object.entries(c.platformOfflineByKind) as [PaymentKind, number][];
  const d = c.onlineDifferenceCents;
  return (
    <section className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold">Pedidos do iFood neste turno</h2>
        {canSync && apiConfigured ? <><IfoodAutoSync /><IfoodSyncButton sessionId={sessionId} /></> : null}
      </div>
      {canSync ? (
        <div className="space-y-1">
          <IfoodReportUpload sessionId={sessionId} />
          <p className="text-xs text-stone-500">No Portal do Parceiro: Pedidos, Exportar, e depois Relatórios, Exportações, Baixar. Pode enviar o mesmo dia mais de uma vez: nada é duplicado.</p>
        </div>
      ) : null}
      <p className="text-xs text-stone-500">
        {c.activeCount} pedido(s) válido(s){c.cancelledCount ? `, ${c.cancelledCount} cancelado(s) (${formatBRL(c.cancelledCents)}, fora da conta)` : ""}.
        {c.lastSyncInfo ?? `Última busca: ${c.lastSyncAt ? formatDateTimeBR(c.lastSyncAt) : "nunca"}.`}
      </p>

      <div className="grid gap-2 sm:grid-cols-3">
        <div className="rounded-lg bg-stone-50 p-3"><div className="text-xs uppercase text-stone-500">Pago no app (iFood)</div><div className="text-lg font-bold tabular-nums">{formatBRL(c.platformOnlineCents)}</div></div>
        <div className="rounded-lg bg-stone-50 p-3"><div className="text-xs uppercase text-stone-500">Lançado no caixa ({c.channelName}, online)</div><div className="text-lg font-bold tabular-nums">{formatBRL(c.systemOnlineCents)}</div></div>
        <div className={`rounded-lg p-3 ${d === 0 ? "bg-green-50" : "bg-red-50"}`}>
          <div className="text-xs uppercase text-stone-500">Diferença</div>
          <div className="text-lg"><Diff cents={d} /></div>
          <div className="text-xs text-stone-600">{d === 0 ? "Bateu com o iFood." : d < 0 ? "Faltou lançar no caixa." : "Lançado a mais que o iFood."}</div>
        </div>
      </div>

      {offline.length ? (
        <p className="text-sm text-stone-700">
          Recebido na entrega (entra na conferência de {offline.map(([k]) => KIND_LABEL[k].toLowerCase()).join(", ")}):{" "}
          {offline.map(([k, v]) => `${KIND_LABEL[k]} ${formatBRL(v)}`).join(" · ")}
        </p>
      ) : null}
      {c.sessionsInShift > 1 ? (
        <p className="text-xs text-amber-800">Há {c.sessionsInShift} caixas neste turno. O iFood não separa pedidos por caixa: compare com a soma dos caixas.</p>
      ) : null}

      {c.orders.length ? (
        <details>
          <summary className="cursor-pointer text-sm font-medium text-brand-700">Ver os {c.orders.length} pedidos</summary>
          <table className="mt-2 w-full text-sm">
            <thead><tr><th className="th">Pedido</th><th className="th">Hora</th><th className="th text-right">App</th><th className="th text-right">Entrega</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {c.orders.map((o) => (
                <tr key={o.id} className={o.status === "CANCELLED" ? "text-stone-400 line-through" : ""}>
                  <td className="td">{o.displayId ?? "-"}</td><td className="td">{formatTimeBR(o.placedAt)}</td>
                  <td className="td num">{formatBRL(o.onlineCents)}</td><td className="td num">{formatBRL(o.offlineCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </section>
  );
}
