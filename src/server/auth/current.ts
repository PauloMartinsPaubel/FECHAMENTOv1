import "server-only";
import { randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { can, Permission } from "@/lib/permissions";
import { CurrentUser, userFromToken } from "../services/auth";

export const SESSION_COOKIE = "fc_session";
/** Identifica o navegador entre um login e outro (para avisar de aparelho novo). Não dá acesso a nada. */
export const DEVICE_COOKIE = "fc_device";

const secureCookie = () => process.env.NODE_ENV === "production" && process.env.COOKIE_SECURE !== "false";

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
    secure: secureCookie(),
    path: "/",
    expires: expiresAt,
  });
}

/** Identificador aleatório deste navegador; cria na primeira vez e guarda por 400 dias (o máximo dos navegadores). */
export async function deviceKey(): Promise<string> {
  const jar = await cookies();
  const current = jar.get(DEVICE_COOKIE)?.value;
  if (current && /^[A-Za-z0-9_-]{20,64}$/.test(current)) return current;
  const fresh = randomBytes(24).toString("base64url");
  jar.set(DEVICE_COOKIE, fresh, { httpOnly: true, sameSite: "lax", secure: secureCookie(), path: "/", maxAge: 400 * 86_400 });
  return fresh;
}

/** Endereço do sistema para links em e-mail: APP_URL ou, sem ela, o endereço desta requisição. */
export async function appBaseUrl(): Promise<string> {
  if (process.env.APP_URL) return process.env.APP_URL;
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`;
}

export async function clearSessionCookie(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
}

/** Usuário logado ou null. Uma consulta por requisição. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const token = await readToken();
  return userFromToken(token, await clientIp());
});

/**
 * Exige login; redireciona para /login. Redireciona para troca de senha se for o primeiro acesso e,
 * depois dela, para Minha conta se o restaurante exige a verificação em duas etapas e falta ligar.
 */
export async function requireUser(options: { allowPasswordChange?: boolean; allowTwoFactorSetup?: boolean } = {}): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword) {
    if (!options.allowPasswordChange) redirect("/conta/senha");
    return user;
  }
  if (user.mustSetupTwoFactor && !options.allowTwoFactorSetup) redirect("/conta?exigido=1");
  return user;
}

/** Para downloads e rotas de API: só quem já está liberado (sem troca de senha nem verificação pendente). */
export async function getApiUser(): Promise<CurrentUser | null> {
  const user = await getCurrentUser();
  return user && !user.mustChangePassword && !user.mustSetupTwoFactor ? user : null;
}

/** Exige login e permissão; sem permissão vai para a página inicial com aviso. */
export async function requirePermission(permission: Permission): Promise<CurrentUser> {
  const user = await requireUser();
  if (!can(user.role, permission)) redirect("/?negado=1");
  return user;
}
