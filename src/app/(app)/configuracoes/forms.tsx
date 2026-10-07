"use client";

import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { Field } from "@/components/ui";
import { saveCatalogAction, saveSettingsAction } from "@/app/actions/admin";

export function SettingsForm({
  values,
}: {
  values: {
    restaurantName: string; defaultOpeningFloat: string; tolerance: string; defaultFloatMode: string; recipients: string; emailFrom: string;
    alertRecipients: string; alertThreshold: string;
  };
}) {
  return (
    <ActionForm action={saveSettingsAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Nome do restaurante" htmlFor="restaurantName"><input id="restaurantName" name="restaurantName" defaultValue={values.restaurantName} required className="input" /></Field>
      <Field label="Fundo de caixa padrão (R$)" htmlFor="defaultOpeningFloat" hint="Valor sugerido na abertura de cada caixa. Começa em R$ 100,00.">
        <MoneyInput name="defaultOpeningFloat" defaultValue={values.defaultOpeningFloat} required />
      </Field>
      <Field label="Tolerância de diferença (R$)" htmlFor="tolerance" hint="Diferença total (soma dos módulos) aceita sem justificativa. R$ 0,00 exige justificativa para qualquer diferença.">
        <MoneyInput name="tolerance" defaultValue={values.tolerance} required />
      </Field>
      <Field label="Fundo entre turnos (padrão)" htmlFor="defaultFloatMode" hint="Nova abertura: cada turno tem fundo novo e os dois somam no dia. Transferência: o mesmo fundo passa de um turno para o outro e não soma de novo.">
        <select id="defaultFloatMode" name="defaultFloatMode" defaultValue={values.defaultFloatMode} className="input">
          <option value="NEW_OPENING">Nova abertura</option>
          <option value="TRANSFER">Transferência de fundo entre turnos</option>
        </select>
      </Field>
      <Field label="Destinatários do relatório de fechamento" htmlFor="recipients" hint="Separe por vírgula. Até 10 e-mails." className="sm:col-span-2">
        <input id="recipients" name="recipients" defaultValue={values.recipients} className="input" placeholder="gerente@restaurante.com.br, dono@restaurante.com.br" autoComplete="off" />
      </Field>
      <fieldset className="grid gap-4 rounded-lg border border-red-200 bg-red-50/40 p-4 sm:col-span-2 sm:grid-cols-2">
        <legend className="px-1 text-sm font-semibold text-red-900">Alerta de divergência</legend>
        <Field label="Quem recebe o alerta" htmlFor="alertRecipients" hint="Recebe um e-mail na hora em que um caixa fecha com diferença acima do limite. Vazio desliga o alerta." className="sm:col-span-2">
          <input id="alertRecipients" name="alertRecipients" defaultValue={values.alertRecipients} className="input" placeholder="dono@restaurante.com.br" autoComplete="off" />
        </Field>
        <Field label="Alertar quando a diferença passar de (R$)" htmlFor="alertThreshold" hint="Soma das diferenças do caixa. Vazio usa a tolerância acima.">
          <MoneyInput name="alertThreshold" defaultValue={values.alertThreshold} placeholder="usa a tolerância" />
        </Field>
      </fieldset>
      <Field label="Remetente do e-mail (opcional)" htmlFor="emailFrom" hint="Se vazio, usa EMAIL_FROM do servidor." className="sm:col-span-2">
        <input id="emailFrom" name="emailFrom" defaultValue={values.emailFrom} className="input" placeholder="Fechamento de Caixa <caixa@seudominio.com.br>" />
      </Field>
      <div className="sm:col-span-2"><button type="submit" className="btn-primary">Salvar configurações</button></div>
    </ActionForm>
  );
}

type Item = { id: string; name: string; active: boolean; isPlatform?: boolean; startTime?: string; endTime?: string; methodKind?: string; methodKindLabel?: string };

export function CatalogRow({ kind, item }: { kind: "register" | "shift" | "channel" | "method" | "brand"; item: Item }) {
  const isCash = item.methodKind === "CASH";
  return (
    <li className="py-3">
      <ActionForm action={saveCatalogAction} hidden={{ kind, id: item.id, hasActive: "1" }} className="flex flex-wrap items-end gap-3">
        <Field label="Nome" htmlFor={`${kind}-${item.id}`} className="min-w-48 flex-1">
          <input id={`${kind}-${item.id}`} name="name" defaultValue={item.name} required maxLength={100} className="input" />
        </Field>
        {kind === "shift" ? (
          <>
            <Field label="Início" htmlFor={`s-${item.id}`}><input id={`s-${item.id}`} name="startTime" type="time" defaultValue={item.startTime} className="input" required /></Field>
            <Field label="Fim" htmlFor={`e-${item.id}`}><input id={`e-${item.id}`} name="endTime" type="time" defaultValue={item.endTime} className="input" required /></Field>
          </>
        ) : null}
        {kind === "method" ? <span className="pb-2.5 text-sm text-stone-600">Tipo: <strong>{item.methodKindLabel}</strong></span> : null}
        {kind === "channel" ? <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" name="isPlatform" defaultChecked={item.isPlatform} /> Plataforma</label> : null}
        {isCash ? <><input type="hidden" name="active" value="on" /><span className="pb-2.5 text-sm text-stone-500">Sempre ativa</span></> : <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" name="active" defaultChecked={item.active} /> Ativo</label>}
        <button type="submit" className="btn-secondary">Salvar</button>
      </ActionForm>
    </li>
  );
}

const METHOD_KINDS = [
  ["CREDIT", "Cartão de crédito"], ["DEBIT", "Cartão de débito"], ["PIX", "PIX"], ["TICKET", "Tickets / Vales (por bandeira)"], ["ONLINE", "Pagamento online (por plataforma)"], ["OTHER", "Outros"],
];

export function NewCatalogItem({ kind }: { kind: "register" | "channel" | "method" | "brand" }) {
  const labels = { register: "Novo caixa", channel: "Novo canal", method: "Nova forma de pagamento", brand: "Nova bandeira de ticket" };
  return (
    <ActionForm action={saveCatalogAction} hidden={{ kind }} resetOnSuccess className="flex flex-wrap items-end gap-3">
      <Field label={labels[kind]} htmlFor={`new-${kind}`} className="min-w-48 flex-1"><input id={`new-${kind}`} name="name" required maxLength={100} className="input" /></Field>
      {kind === "method" ? (
        <Field label="Tipo" htmlFor="new-method-kind">
          <select id="new-method-kind" name="methodKind" className="input" required>{METHOD_KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        </Field>
      ) : null}
      {kind === "channel" ? <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" name="isPlatform" /> Plataforma</label> : null}
      <button type="submit" className="btn-primary">Adicionar</button>
    </ActionForm>
  );
}
