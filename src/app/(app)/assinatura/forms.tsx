"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { ConfirmSubmit } from "@/components/small-client";
import { cancelSubscriptionAction, subscribeAction, syncBillingAction } from "@/app/actions/billing";

export function SubscribeForm({ defaultEmail }: { defaultEmail: string }) {
  return (
    <ActionForm action={subscribeAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="CPF ou CNPJ de quem paga" htmlFor="document" hint="Vai na fatura e na nota fiscal.">
        <input id="document" name="document" required inputMode="numeric" autoComplete="off" className="input" placeholder="00.000.000/0000-00" />
      </Field>
      <Field label="E-mail que recebe as faturas" htmlFor="email">
        <input id="email" name="email" type="email" required defaultValue={defaultEmail} className="input" />
      </Field>
      <div className="sm:col-span-2"><button type="submit" className="btn-primary">Assinar</button></div>
    </ActionForm>
  );
}

export function SyncForm() {
  return (
    <ActionForm action={syncBillingAction}>
      <button type="submit" className="btn-secondary">Atualizar com o Asaas</button>
    </ActionForm>
  );
}

export function CancelForm() {
  return (
    <ActionForm action={cancelSubscriptionAction}>
      <ConfirmSubmit className="btn-secondary text-red-700" message="Cancelar a assinatura? As próximas mensalidades deixam de ser cobradas. Os caixas continuam liberados até o fim do período já pago (ou do teste grátis); depois disso, os dados ficam guardados só para consulta.">
        Cancelar assinatura
      </ConfirmSubmit>
    </ActionForm>
  );
}
