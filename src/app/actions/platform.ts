"use server";

import { revalidatePath } from "next/cache";
import { formatDateBR } from "@/lib/dates";
import { extendTrial, setRestaurantPricing } from "@/server/services/platform";
import type { ActionState } from "./types";
import { actorFromSession, moneyField, run, str } from "./util";

export async function setPricingAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const r = await setRestaurantPricing(actor, str(fd, "restaurantId"), {
      monthlyCents: moneyField(fd, "monthly", "a mensalidade"),
      annualCents: moneyField(fd, "annual", "o valor anual"),
    });
    revalidatePath("/plataforma");
    return r.asaasUpdated ? "Preço salvo. A assinatura no Asaas e a cobrança em aberto já estão com o valor novo." : "Preço salvo.";
  });
}

export async function extendTrialAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const until = str(fd, "until");
    await extendTrial(actor, str(fd, "restaurantId"), until);
    revalidatePath("/plataforma");
    return `Teste grátis estendido até ${formatDateBR(until)}.`;
  });
}
