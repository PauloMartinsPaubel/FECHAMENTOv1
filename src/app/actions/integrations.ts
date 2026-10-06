"use server";

import { revalidatePath } from "next/cache";
import { errorMessage } from "@/server/errors";
import type { IfoodMerchant } from "@/server/integrations/ifood/client";
import { listIfoodMerchants, saveIfoodSettings, syncIfoodNow } from "@/server/services/integrations";
import type { ActionState } from "./types";
import { actorFromSession, bool, optStr, run, str } from "./util";

export async function saveIfoodSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await saveIfoodSettings(actor, { merchantId: str(fd, "merchantId"), channelId: str(fd, "channelId"), enabled: bool(fd, "enabled") });
    revalidatePath("/integracoes");
    return "Configuração do iFood salva.";
  });
}

export async function syncIfoodAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const r = await syncIfoodNow(actor);
    revalidatePath("/integracoes");
    const sessionId = optStr(fd, "sessionId");
    if (sessionId) revalidatePath(`/caixa/${sessionId}`, "layout");
    if (r.failedOrders.length) {
      return `${r.ordersSaved} pedido(s) atualizado(s). ${r.failedOrders.length} não puderam ser lidos agora e serão buscados de novo na próxima vez.`;
    }
    return r.events === 0 ? "Nenhum pedido novo no iFood." : `${r.ordersSaved} pedido(s) do iFood atualizado(s).`;
  });
}

export async function listIfoodMerchantsAction(): Promise<{ ok: true; merchants: IfoodMerchant[] } | { ok: false; error: string }> {
  try {
    const actor = await actorFromSession();
    return { ok: true, merchants: await listIfoodMerchants(actor) };
  } catch (err) {
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    return { ok: false, error: errorMessage(err) };
  }
}
