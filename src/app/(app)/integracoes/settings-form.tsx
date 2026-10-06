"use client";

import { useState, useTransition } from "react";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { listIfoodMerchantsAction, saveIfoodSettingsAction } from "@/app/actions/integrations";

type Merchant = { id: string; name: string | null; corporateName: string | null };

export function IfoodSettingsForm({
  merchantId,
  channelId,
  enabled,
  channels,
  credentialsConfigured,
}: {
  merchantId: string;
  channelId: string;
  enabled: boolean;
  channels: { id: string; name: string }[];
  credentialsConfigured: boolean;
}) {
  const [value, setValue] = useState(merchantId);
  const [merchants, setMerchants] = useState<Merchant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function findStores() {
    setError(null);
    startTransition(async () => {
      const r = await listIfoodMerchantsAction();
      if (r.ok) setMerchants(r.merchants);
      else setError(r.error);
    });
  }

  return (
    <ActionForm action={saveIfoodSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Código da loja no iFood (merchantId)" htmlFor="merchantId" hint="Use o botão abaixo para buscar direto no iFood. Não é senha.">
        <input id="merchantId" name="merchantId" value={value} onChange={(e) => setValue(e.target.value)} className="input" autoComplete="off" maxLength={100} />
      </Field>
      <Field label="Canal do caixa que recebe os pedidos" htmlFor="channelId">
        <select id="channelId" name="channelId" defaultValue={channelId} className="input" required>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>

      {credentialsConfigured ? (
        <div className="space-y-2 sm:col-span-2">
          <button type="button" className="btn-secondary" onClick={findStores} disabled={pending}>
            {pending ? "Buscando..." : "Buscar minhas lojas no iFood"}
          </button>
          {error ? <p className="text-sm text-red-700">{error}</p> : null}
          {merchants && merchants.length === 0 ? (
            <p className="text-sm text-stone-600">
              Nenhuma loja liberada para este aplicativo. A loja precisa autorizar o aplicativo no iFood antes de aparecer aqui.
            </p>
          ) : null}
          {merchants && merchants.length > 0 ? (
            <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
              {merchants.map((m) => (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
                  <span>
                    <strong>{m.name ?? "Loja sem nome"}</strong>
                    {m.corporateName ? <span className="text-stone-500"> · {m.corporateName}</span> : null}
                    <span className="block font-mono text-xs text-stone-500">{m.id}</span>
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => setValue(m.id)} disabled={value === m.id}>
                    {value === m.id ? "Selecionada" : "Usar esta loja"}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="enabled" defaultChecked={enabled} /> Integração ligada
      </label>
      <div className="sm:col-span-2"><button type="submit" className="btn-primary">Salvar</button></div>
    </ActionForm>
  );
}
