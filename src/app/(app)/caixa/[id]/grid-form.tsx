"use client";

import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { addGridAction } from "@/app/actions/cash";

export type GridColumn = { methodId: string; brandId: string | null; label: string };

/** Grade canal x forma: cada campo preenchido vira uma venda. Tudo ou nada. */
export function GridForm({
  sessionId,
  channels,
  columns,
  correction,
}: {
  sessionId: string;
  channels: { id: string; name: string }[];
  columns: GridColumn[];
  correction: boolean;
}) {
  return (
    <ActionForm action={addGridAction} idempotent resetOnSuccess hidden={{ sessionId }} className="space-y-3">
      <div className="overflow-x-auto rounded-lg border border-stone-200">
        <table className="w-full min-w-[720px] text-sm">
          <thead className="bg-stone-50">
            <tr>
              <th className="th sticky left-0 bg-stone-50">Canal</th>
              {columns.map((c) => <th key={`${c.methodId}${c.brandId}`} className="th text-right">{c.label}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {channels.map((ch) => (
              <tr key={ch.id}>
                <th scope="row" className="td sticky left-0 bg-white text-left font-medium">{ch.name}</th>
                {columns.map((c) => (
                  <td key={`${c.methodId}${c.brandId}`} className="td">
                    <MoneyInput
                      name={`cell:${ch.id}:${c.methodId}:${c.brandId ?? "-"}`}
                      id={`cell-${ch.id}-${c.methodId}-${c.brandId ?? "x"}`}
                      className="input-money px-2! py-1.5! text-sm"
                      placeholder=""
                      ariaLabel={`${ch.name}, ${c.label}`}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {correction ? (
        <div>
          <label className="label" htmlFor="grid-reason">Motivo da correção</label>
          <input id="grid-reason" name="reason" required minLength={3} maxLength={500} className="input" />
        </div>
      ) : null}
      <p className="text-xs text-stone-500">
        Cada valor preenchido é lançado como uma venda naquele canal e forma. Para corrigir depois, use as opções da aba Lançamentos.
      </p>
      <button type="submit" className="btn-primary">Lançar valores da grade</button>
    </ActionForm>
  );
}
