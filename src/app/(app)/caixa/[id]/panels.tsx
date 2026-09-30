"use client";

import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { ConfirmSubmit } from "@/components/small-client";
import { Field } from "@/components/ui";
import { correctFloatAction, reopenAction, sendEmailAction } from "@/app/actions/cash";

export function EmailPanel({ sessionId, defaultRecipients, hasPrevious, lastFailed }: { sessionId: string; defaultRecipients: string; hasPrevious: boolean; lastFailed: boolean }) {
  return (
    <ActionForm action={sendEmailAction} hidden={{ sessionId }} className="space-y-3">
      <Field label="Enviar para (separe por vírgula)" htmlFor="recipients" hint="O fechamento já está salvo. O envio do e-mail é separado: se falhar, é só reenviar.">
        <input id="recipients" name="recipients" type="text" defaultValue={defaultRecipients} placeholder="gerente@restaurante.com.br" className="input" autoComplete="off" />
      </Field>
      <button type="submit" className={lastFailed ? "btn-primary" : "btn-secondary"}>
        {hasPrevious ? (lastFailed ? "Reenviar e-mail" : "Enviar de novo") : "Enviar por e-mail"}
      </button>
    </ActionForm>
  );
}

export function ReopenPanel({ sessionId }: { sessionId: string }) {
  return (
    <ActionForm action={reopenAction} hidden={{ sessionId }} className="space-y-3">
      <Field label="Motivo da reabertura" htmlFor="reopen-reason" hint="O caixa volta para correção. Tudo o que for alterado fica registrado com este motivo.">
        <input id="reopen-reason" name="reason" required minLength={5} maxLength={500} className="input" placeholder="Ex.: contagem do dinheiro estava errada" />
      </Field>
      <ConfirmSubmit className="btn-danger" message="Reabrir este caixa para correção?">Reabrir caixa</ConfirmSubmit>
    </ActionForm>
  );
}

export function FloatPanel({ sessionId, currentFloat }: { sessionId: string; currentFloat: string }) {
  return (
    <ActionForm action={correctFloatAction} hidden={{ sessionId }} className="grid gap-3 sm:grid-cols-6">
      <Field label="Novo fundo (R$)" htmlFor="float-value" className="sm:col-span-2">
        <MoneyInput name="openingFloat" id="float-value" defaultValue={currentFloat} required />
      </Field>
      <Field label="Motivo" htmlFor="float-reason" className="sm:col-span-3">
        <input id="float-reason" name="reason" required minLength={3} maxLength={500} className="input" />
      </Field>
      <div className="flex items-end sm:col-span-1"><button type="submit" className="btn-secondary w-full">Corrigir fundo</button></div>
    </ActionForm>
  );
}
