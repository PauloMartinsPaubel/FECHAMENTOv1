"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { saveIfoodSettingsAction } from "@/app/actions/integrations";

export function IfoodSettingsForm({ merchantId, channelId, enabled, channels }: { merchantId: string; channelId: string; enabled: boolean; channels: { id: string; name: string }[] }) {
  return (
    <ActionForm action={saveIfoodSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Código da loja no iFood (merchantId)" htmlFor="merchantId" hint="Aparece no Portal do Parceiro do iFood. Não é senha.">
        <input id="merchantId" name="merchantId" defaultValue={merchantId} className="input" autoComplete="off" maxLength={100} />
      </Field>
      <Field label="Canal do caixa que recebe os pedidos" htmlFor="channelId">
        <select id="channelId" name="channelId" defaultValue={channelId} className="input" required>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <label className="flex items-center gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="enabled" defaultChecked={enabled} /> Integração ligada
      </label>
      <div className="sm:col-span-2"><button type="submit" className="btn-primary">Salvar</button></div>
    </ActionForm>
  );
}
