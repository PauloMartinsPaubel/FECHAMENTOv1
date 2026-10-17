"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { ConfirmSubmit } from "@/components/small-client";
import { cancelSubscriptionAction, subscribeAction, syncBillingAction } from "@/app/actions/billing";
import { annualDeal } from "@/lib/billing";
import { formatBRL } from "@/lib/finance";

const OPTION =
  "flex min-h-16 cursor-pointer flex-col justify-center rounded-lg border border-stone-300 bg-white px-4 py-3 text-sm text-stone-800 transition-colors hover:border-green-700 hover:bg-green-50 has-[:checked]:border-green-700 has-[:checked]:bg-green-50 has-[:checked]:ring-2 has-[:checked]:ring-green-700 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-green-600";

export function SubscribeForm({ defaultEmail, monthlyCents, annualCents }: { defaultEmail: string; monthlyCents: number; annualCents: number | null }) {
  const deal = annualCents ? annualDeal(monthlyCents, annualCents) : null;
  return (
    <ActionForm action={subscribeAction} className="grid gap-4 sm:grid-cols-2">
      {annualCents && deal ? (
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Plano</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <label htmlFor="cycle-monthly" className={OPTION}>
              <input id="cycle-monthly" type="radio" name="cycle" value="MONTHLY" defaultChecked className="sr-only" />
              <span className="font-semibold">Mensal: {formatBRL(monthlyCents)} por mês</span>
              <span className="text-stone-600">Cobrado todo mês.</span>
            </label>
            <label htmlFor="cycle-yearly" className={OPTION}>
              <input id="cycle-yearly" type="radio" name="cycle" value="YEARLY" className="sr-only" />
              <span className="font-semibold">Anual: {formatBRL(annualCents)} por ano</span>
              <span className="text-stone-600">
                Pago de uma vez. Sai por {formatBRL(deal.perMonthCents)} por mês
                {deal.monthsFree ? `, ${deal.monthsFree} ${deal.monthsFree === 1 ? "mês" : "meses"} grátis` : `, economia de ${formatBRL(deal.savedCents)}`}.
              </span>
            </label>
          </div>
        </fieldset>
      ) : null}
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
      <ConfirmSubmit className="btn-secondary text-red-700" message="Cancelar a assinatura? As próximas cobranças deixam de ser feitas. Os caixas continuam liberados até o fim do período já pago (ou do teste grátis); depois disso, os dados ficam guardados só para consulta.">
        Cancelar assinatura
      </ConfirmSubmit>
    </ActionForm>
  );
}
