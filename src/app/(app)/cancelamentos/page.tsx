import type { Metadata } from "next";
import Link from "next/link";
import { formatDateBR, formatTimeBR, fromDbDate, isIsoDate, todayIso } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { Alert, Empty, PageHeader, Pagination, Stat } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { loadCatalogRows } from "@/server/loaders";
import { listCancellations, presetRange } from "@/server/services/queries";

export const metadata: Metadata = { title: "Cancelamentos" };

export default async function CancellationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const def = presetRange("30dias");
  const from = isIsoDate(sp.from) ? sp.from : def.from;
  const to = isIsoDate(sp.to) ? sp.to : def.to;
  const channelId = sp.channelId || undefined;
  void (await clientIp());
  const catalog = await loadCatalogRows(prisma, user.restaurantId);
  let result = null;
  let error: string | null = null;
  try {
    result = await listCancellations(user, { from, to, channelId, page: Number(sp.page) || 1 });
  } catch (err) {
    error = err instanceof ServiceError ? err.message : "Não foi possível carregar.";
  }
  return (
    <div className="space-y-5">
      <PageHeader title="Cancelamentos" subtitle="Pedidos cancelados ficam guardados e nunca entram no faturamento." actions={<a className="btn-secondary" href={`/api/export/cancelamentos?from=${from}&to=${to}`}>Exportar CSV</a>} />
      <form method="get" className="card no-print flex flex-wrap items-end gap-3">
        <div><label className="label" htmlFor="from">De</label><input id="from" name="from" type="date" defaultValue={from} max={todayIso()} className="input" /></div>
        <div><label className="label" htmlFor="to">Até</label><input id="to" name="to" type="date" defaultValue={to} max={todayIso()} className="input" /></div>
        <div><label className="label" htmlFor="channelId">Canal</label><select id="channelId" name="channelId" defaultValue={channelId ?? ""} className="input"><option value="">Todos</option>{catalog.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <button className="btn-primary" type="submit">Filtrar</button>
      </form>
      {error ? <Alert tone="error">{error}</Alert> : null}
      {result ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2"><Stat label="Pedidos cancelados" value={result.total} /><Stat label="Valor cancelado" value={formatBRL(result.totalCents)} hint="Fora do faturamento" /></div>
          {result.rows.length === 0 ? <Empty>Nenhum cancelamento no período.</Empty> : (
            <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-stone-50"><tr><th className="th">Data e hora</th><th className="th">Pedido</th><th className="th">Canal</th><th className="th">Forma</th><th className="th">Motivo</th><th className="th">Funcionário</th><th className="th text-right">Valor</th></tr></thead>
                <tbody className="divide-y divide-stone-100">
                  {result.rows.map((c) => (
                    <tr key={c.id}>
                      <td className="td"><Link className="link" href={`/caixa/${c.sessionId}`}>{formatDateBR(fromDbDate(c.session.businessDate))}</Link> <span className="text-xs text-stone-500">{formatTimeBR(c.occurredAt)} · {c.session.shift.name}</span></td>
                      <td className="td">{c.orderNumber}</td>
                      <td className="td">{c.channel.name}</td>
                      <td className="td">{c.paymentMethod?.name ?? "-"}</td>
                      <td className="td">{c.reason}{c.movementId ? "" : <span className="block text-xs text-stone-500">nunca lançado como venda</span>}</td>
                      <td className="td">{c.employeeName}</td>
                      <td className="td num font-semibold">{formatBRL(c.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={result.page} pages={result.pages} basePath="/cancelamentos" params={{ from, to, channelId }} />
        </>
      ) : null}
    </div>
  );
}
