import { formatBRL, KIND_LABEL, type ConferenceLine, type DivergenceSummary, type CashBreakdown } from "@/lib/finance";
import { statusText } from "@/lib/reports/labels";
import { Diff } from "@/components/ui";

type Row = Pick<ConferenceLine, "key" | "group" | "label" | "fullLabel" | "expectedCents" | "checkedCents" | "differenceCents">;

/** Conferência somente leitura (caixa fechado): o que foi registrado, conferido e a diferença de cada linha. */
export function ConferenceTable({
  lines,
  cash,
  divergence,
}: {
  lines: Row[];
  cash: CashBreakdown;
  divergence: Pick<DivergenceSummary, "netCents" | "absCents" | "status" | "origins" | "hints">;
}) {
  lines = lines.filter((l) => l.expectedCents !== 0 || l.checkedCents !== null);
  const groups = [...new Set(lines.map((l) => l.group))];
  return (
    <div className="space-y-4">
      <section className="card">
        <h2 className="card-title">Conferência de valores</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-300">
              <th className="th">Item</th><th className="th text-right">Sistema</th><th className="th text-right">Conferido</th><th className="th text-right">Diferença</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <GroupRows key={g} group={g} lines={lines.filter((l) => l.group === g)} />
            ))}
          </tbody>
        </table>
        <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-stone-50 p-3 text-sm">
          <dt className="font-semibold">Como o dinheiro esperado foi calculado</dt><dd />
          <dt>Fundo de abertura</dt><dd className="num">{formatBRL(cash.floatCents)}</dd>
          <dt>(+) Vendas em dinheiro</dt><dd className="num">{formatBRL(cash.salesCents)}</dd>
          <dt>(+) Suprimentos</dt><dd className="num">{formatBRL(cash.suppliesCents)}</dd>
          <dt>(-) Sangrias</dt><dd className="num">{formatBRL(-cash.withdrawalsCents)}</dd>
          <dt>(-) Despesas em dinheiro</dt><dd className="num">{formatBRL(-cash.expensesCents)}</dd>
          <dt>(-) Estornos em dinheiro</dt><dd className="num">{formatBRL(-cash.refundsCents)}</dd>
          {cash.adjustmentsCents !== 0 ? (<><dt>(+/-) Ajustes</dt><dd className="num">{formatBRL(cash.adjustmentsCents)}</dd></>) : null}
          <dt className="border-t border-stone-300 pt-1 font-bold">Dinheiro esperado</dt><dd className="num border-t border-stone-300 pt-1 font-bold">{formatBRL(cash.expectedCents)}</dd>
        </dl>
      </section>

      <section className="card">
        <h2 className="card-title">Divergência total</h2>
        <p className="text-2xl font-bold"><Diff cents={divergence.netCents} /> <span className="ml-2 text-base font-semibold">{statusText(divergence.status, divergence.netCents, divergence.absCents)}</span></p>
        {divergence.origins.length > 0 ? (
          <>
            <h3 className="mt-3 text-sm font-semibold">Possíveis origens</h3>
            <ul className="mt-1 text-sm">
              {divergence.origins.map((o) => (
                <li key={o.key} className="flex justify-between border-b border-stone-100 py-1"><span>{o.label}</span><Diff cents={o.differenceCents} /></li>
              ))}
            </ul>
            {divergence.hints.length > 0 ? (
              <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-stone-700">
                {divergence.hints.map((h) => <li key={h}>{h}</li>)}
              </ul>
            ) : null}
          </>
        ) : null}
      </section>
    </div>
  );
}

function GroupRows({ group, lines }: { group: string; lines: Row[] }) {
  const sumE = lines.reduce((a, l) => a + l.expectedCents, 0);
  const sumC = lines.reduce((a, l) => a + (l.checkedCents ?? 0), 0);
  const sumD = lines.reduce((a, l) => a + (l.differenceCents ?? 0), 0);
  return (
    <>
      <tr className="bg-stone-50"><td colSpan={4} className="px-3 py-1 text-xs font-bold uppercase tracking-wide text-stone-600">{KIND_LABEL[group as keyof typeof KIND_LABEL]}</td></tr>
      {lines.map((l) => (
        <tr key={l.key} className="border-b border-stone-100">
          <td className="td">{l.fullLabel}</td>
          <td className="td num">{formatBRL(l.expectedCents)}</td>
          <td className="td num">{l.checkedCents === null ? <span className="text-stone-400">-</span> : formatBRL(l.checkedCents)}</td>
          <td className="td num"><Diff cents={l.differenceCents} /></td>
        </tr>
      ))}
      {lines.length > 1 ? (
        <tr className="border-b border-stone-200 font-semibold">
          <td className="td">Total</td><td className="td num">{formatBRL(sumE)}</td><td className="td num">{formatBRL(sumC)}</td><td className="td num"><Diff cents={sumD} /></td>
        </tr>
      ) : null}
    </>
  );
}
