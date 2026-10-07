"use server";

import { revalidatePath } from "next/cache";
import { formatDateBR } from "@/lib/dates";
import { cancelSubscription, subscribe, syncBillingPayments } from "@/server/services/billing";
import type { ActionState } from "./types";
import { actorFromSession, run, str } from "./util";

export async function subscribeAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const r = await subscribe(actor, { document: str(fd, "document"), email: str(fd, "email") });
    revalidatePath("/", "layout");
    return `Assinatura criada. A primeira mensalidade vence em ${formatDateBR(r.nextDueDate)}; a fatura chega por e-mail e aparece aqui.`;
  });
}

export async function syncBillingAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const n = await syncBillingPayments(actor.restaurantId);
    revalidatePath("/", "layout");
    return `${n} cobrança(s) atualizada(s) com o Asaas.`;
  });
}

export async function cancelSubscriptionAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await cancelSubscription(actor);
    revalidatePath("/", "layout");
    return "Assinatura cancelada. Os dados continuam disponíveis para consulta.";
  });
}
