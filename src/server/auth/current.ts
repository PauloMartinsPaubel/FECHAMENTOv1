import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, Permission } from "@/lib/permissions";
import { CurrentUser, userFromToken } from "../services/auth";

export const SESSION_COOKIE = "fc_session";

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for");
  return (forwarded ? forwarded.split(",")[0].trim() : h.get("x-real-ip")) || null;
}

export async function readToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

export async function setSessionCookie(token: string, expiresAt: Date): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Usuário logado ou null. Uma consulta por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readToken();
  return userFromToken(token, await clientIp());
});

/** Exige login; redireciona para /login. Redireciona para troca de senha se for o primeiro acesso. */
export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/conta/senha");
  return user;
}

/** Exige login e permissão; sem permissão vai para a página inicial com aviso. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/?negado=1");
  return user;
}
