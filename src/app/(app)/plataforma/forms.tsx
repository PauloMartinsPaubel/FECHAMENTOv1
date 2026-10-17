"use client";

import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { formatDecimalComma } from "@/lib/finance";
import { extendTrialAction, setPricingAction } from "@/app/actions/platform";

export function PricingForm({ restaurantId, monthlyCents, annualCents, standard }: { restaurantId: string; monthlyCents: number | null; annualCents: number | null; standard: string }) {
  return (
    <ActionForm action={setPricingAction} hidden={{ restaurantId }} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
      <label className="block text-sm">
        <span className="label">Mensalidade combinada (R$)</span>
        <MoneyInput name="monthly" id={`monthly-${restaurantId}`} defaultValue={monthlyCents ? formatDecimalComma(monthlyCents) : ""} placeholder={standard} className="input-money w-full" />
      </label>
      <label className="block text-sm">
        <span className="label">Plano anual combinado (R$)</span>
        <MoneyInput name="annual" id={`annual-${restaurantId}`} defaultValue={annualCents ? formatDecimalComma(annualCents) : ""} placeholder="sem anual" className="input-money w-full" />
      </label>
      <button type="submit" className="btn-primary">Salvar preço</button>
    </ActionForm>
  );
}

export function TrialForm({ restaurantId, trialEnd, max }: { restaurantId: string; trialEnd: string | null; max: string }) {
  return (
    <ActionForm action={extendTrialAction} hidden={{ restaurantId }} className="flex flex-wrap items-end gap-3">
      <label className="block text-sm">
        <span className="label">Teste grátis até</span>
        <input type="date" name="until" required defaultValue={trialEnd ?? ""} max={max} className="input" />
      </label>
      <button type="submit" className="btn-secondary">Estender teste</button>
    </ActionForm>
  );
}
