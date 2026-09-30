import type { Metadata } from "next";
import { formatBRL } from "@/lib/finance";
import { Empty } from "@/components/ui";
import { getSessionPage } from "@/server/session-page";
import { GridColumn, GridForm } from "../grid-form";

export const metadata: Metadata = { title: "Canal x forma de pagamento" };

export default async function MatrixPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { bundle, editMode } = await getSessionPage(id);
  const { evaluation: ev, catalogRows: cat, session } = bundle;
  const cells = ev.summary.matrix;

  const usedChannels = new Set(cells.map((c) => c.channelId));
  const usedMethods = new Set(cells.map((c) => c.paymentMethodId));
  const channels = cat.channels.filter((c) => c.active || usedChannels.has(c.id));
  const methods = cat.methods.filter((m) => m.active || usedMethods.has(m.id));

  const cellTotal = (channelId: string, methodId: string) => cells.filter((c) => c.channelId === channelId && c.paymentMethodId === methodId).reduce((a, c) => a + c.netCents, 0);
  const brandNames = new Map(cat.brands.map((b) => [b.id, b.name]));
  const brandDetail = (channelId: string, methodId: string) =>
    cells
      .filter((c) => c.channelId === channelId && c.paymentMethodId === methodId && c.ticketBrandId)
      .map((c) => `${brandNames.get(c.ticketBrandId as string)}: ${formatBRL(c.netCents)}`)
      .join(" · ");
  const rowTotal = (channelId: string) => cells.filter((c) => c.channelId === channelId).reduce((a, c) => a + c.netCents, 0);
  const colTotal = (methodId: string) => cells.filter((c) => c.paymentMethodId === methodId).reduce((a, c) => a + c.netCents, 0);

  const columns: GridColumn[] = [];
  for (const m of cat.methods.filter((x) => x.active)) {
    if (m.kind === "TICKET") {
      for (const b of cat.brands.filter((x) => x.active)) columns.push({ methodId: m.id, brandId: b.id, label: b.name });
    } else {
      columns.push({ methodId: m.id, brandId: null, label: m.name });
    }
  }

  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="card-title">Matriz de conferência: canal x forma de pagamento</h2>
        <p className="mb-3 text-sm text-stone-600">
          Cada canal mostra só o que foi lançado nele. 99Food e Eclética são canais separados: um nunca soma no outro.
          A soma da matriz é sempre igual ao faturamento ({formatBRL(ev.summary.revenueCents)}).
        </p>
        {cells.length === 0 ? (
          <Empty>Nenhuma venda lançada ainda.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-stone-300">
                  <th className="th">Canal</th>
                  {methods.map((m) => <th key={m.id} className="th text-right">{m.name}</th>)}
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {channels.filter((c) => usedChannels.has(c.id)).map((c) => (
                  <tr key={c.id}>
                    <th scope="row" className="td text-left font-semibold">{c.name}</th>
                    {methods.map((m) => {
                      const v = cellTotal(c.id, m.id);
                      const detail = m.kind === "TICKET" ? brandDetail(c.id, m.id) : "";
                      return (
                        <td key={m.id} className="td num" title={detail || undefined}>
                          {v === 0 ? <span className="text-stone-300">-</span> : formatBRL(v)}
                          {detail ? <div className="text-[11px] font-normal text-stone-500">{detail}</div> : null}
                        </td>
                      );
                    })}
                    <td className="td num font-semibold">{formatBRL(rowTotal(c.id))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-stone-400 font-bold">
                  <th scope="row" className="td text-left">Total</th>
                  {methods.map((m) => <td key={m.id} className="td num">{formatBRL(colTotal(m.id))}</td>)}
                  <td className="td num">{formatBRL(ev.summary.revenueCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {editMode ? (
        <section className="card">
          <h2 className="card-title">Lançar totais por canal e forma</h2>
          <GridForm sessionId={session.id} channels={channels.filter((c) => c.active).map((c) => ({ id: c.id, name: c.name }))} columns={columns} correction={editMode === "correction"} />
        </section>
      ) : null}
    </div>
  );
}
