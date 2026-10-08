"use server";

import { after } from "next/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { clientIp } from "@/server/auth/current";
import { createPasswordReset, resetPasswordWithToken, sendPasswordResetEmail } from "@/server/services/password-reset";
import { run, str } from "./util";
import type { ActionState } from "./types";

async function appUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

export async function requestResetAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const r = await createPasswordReset(str(fd, "email"), await appUrl(), { ip: await clientIp() });
    // o envio fica para depois da resposta: a tela demora o mesmo com e-mail cadastrado ou não
    if (r) after(() => sendPasswordResetEmail(r));
    return "Se esse e-mail tiver cadastro, enviamos um link para criar uma senha nova. Confira a caixa de entrada e o spam. O link vale por 30 minutos.";
  });
}

export async function resetPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    await resetPasswordWithToken(String(fd.get("token") ?? ""), String(fd.get("password") ?? ""), String(fd.get("confirm") ?? ""), { ip: await clientIp() });
  });
  if (result?.ok) redirect("/login?senha=1");
  return result;
}
