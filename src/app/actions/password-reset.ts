"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import { appBaseUrl, clientIp } from "@/server/auth/current";
import { createPasswordReset, resetPasswordWithToken, sendPasswordResetEmail } from "@/server/services/password-reset";
import { enforce, hit } from "@/server/services/rate-limit";
import { run, str } from "./util";
import type { ActionState } from "./types";

export async function requestResetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const ip = await clientIp();
    // passou do limite: mesma resposta de sempre, mas nenhum e-mail sai (não ajuda quem tenta descobrir e-mails)
    const r = (await hit("senha-pedido", ip)).allowed ? await createPasswordReset(str(fd, "email"), await appBaseUrl(), { ip }) : null;
    // o envio fica para depois da resposta: a tela demora o mesmo com e-mail cadastrado ou não
    if (r) after(() => sendPasswordResetEmail(r));
    return "Se esse e-mail tiver cadastro, enviamos um link para criar uma senha nova. Confira a caixa de entrada e o spam. O link vale por 30 minutos.";
  });
}

export async function resetPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const ip = await clientIp();
    await enforce("senha-link", ip);
    await resetPasswordWithToken(String(fd.get("token") ?? ""), String(fd.get("password") ?? ""), String(fd.get("confirm") ?? ""), { ip });
  });
  if (result?.ok) redirect("/login?senha=1");
  return result;
}
