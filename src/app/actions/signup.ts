"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { clientIp, setSessionCookie } from "@/server/auth/current";
import { loginWithPassword } from "@/server/services/auth";
import { registerRestaurant } from "@/server/services/signup";
import type { ActionState } from "./types";
import { bool, run, str } from "./util";

export async function signupAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const result = await run(async () => {
    const ip = await clientIp();
    const password = String(fd.get("password") ?? "");
    const r = await registerRestaurant(
      {
        inviteCode: str(fd, "inviteCode"),
        restaurantName: str(fd, "restaurantName"),
        adminName: str(fd, "adminName"),
        email: str(fd, "email"),
        password,
        passwordConfirm: String(fd.get("passwordConfirm") ?? ""),
        acceptTerms: bool(fd, "acceptTerms"),
      },
      { ip },
    );
    const h = await headers();
    const login = await loginWithPassword(r.email, password, { ip, userAgent: h.get("user-agent") });
    await setSessionCookie(login.token, login.expiresAt);
  });
  if (result?.ok) redirect("/configuracoes?inicio=1");
  return result;
}
