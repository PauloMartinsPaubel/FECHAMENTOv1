"use server";

import { redirect } from "next/navigation";
import { clearSessionCookie, clientIp, readToken, requireUser, setSessionCookie } from "@/server/auth/current";
import { changeOwnPassword, loginWithPassword, logout } from "@/server/services/auth";
import { headers } from "next/headers";
import { ServiceError } from "@/server/errors";
import { enforce } from "@/server/services/rate-limit";
import { completeSecondStep } from "@/server/services/two-factor";
import { run, str } from "./util";
import type { ActionState } from "./types";

export async function loginAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  let pending = false;
  const result = await run(async () => {
    const email = str(fd, "email");
    const password = String(fd.get("password") ?? "");
    if (!email || !password) throw new ServiceError("Informe e-mail e senha.");
    const h = await headers();
    const ip = await clientIp();
    await enforce("login", ip);
    const r = await loginWithPassword(email, password, { ip, userAgent: h.get("user-agent") });
    await setSessionCookie(r.token, r.expiresAt);
    pending = r.pendingTwoFactor;
  });
  if (result?.ok) redirect(pending ? "/login/codigo" : "/");
  return result;
}

export async function logoutAction(): Promise<void> {
  const user = await requireUser({ allowPasswordChange: true, allowTwoFactorSetup: true });
  await logout({ ...user, ip: await clientIp() }, await readToken());
  await clearSessionCookie();
  redirect("/login");
}

export async function changePasswordAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const user = await requireUser({ allowPasswordChange: true, allowTwoFactorSetup: true });
    const actor = { ...user, ip: await clientIp() };
    const next = String(fd.get("next") ?? "");
    if (next !== String(fd.get("confirm") ?? "")) throw new ServiceError("A confirmação não confere com a nova senha.");
    await changeOwnPassword(actor, String(fd.get("current") ?? ""), next, await readToken());
  });
  if (result?.ok) redirect("/");
  return result;
}

export async function secondStepAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const ip = await clientIp();
    await enforce("duas-etapas", ip);
    const r = await completeSecondStep(await readToken(), str(fd, "code"), { ip });
    await setSessionCookie(r.token, r.expiresAt);
  });
  if (result?.ok) redirect("/");
  return result;
}
