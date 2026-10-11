import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import type { RoleCode } from "@/lib/permissions";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import {
  decryptSecret,
  encryptionAvailable,
  encryptSecret,
  hashRecoveryCode,
  newRecoveryCodes,
  newSecret,
  otpauthUrl,
  verifyCode,
} from "../security/totp";
import { hashToken, SESSION_HOURS, TWO_FACTOR_POLICY_ROLES } from "./auth";

/** Depois da senha certa, quanto tempo a pessoa tem para digitar o código. */
export const SECOND_STEP_MINUTES = 10;
/** Códigos errados seguidos antes de precisar digitar a senha de novo. */
export const MAX_CODE_ATTEMPTS = 5;

export async function twoFactorStatus(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpEnabledAt: true, recoveryCodeHashes: true } });
  return { enabled: Boolean(u.totpEnabledAt), enabledAt: u.totpEnabledAt, recoveryLeft: u.recoveryCodeHashes.length, available: encryptionAvailable() };
}

/** Passo 1 de ligar: gera o segredo (ainda não vale) e o QR code para o aplicativo. */
export async function startTwoFactorSetup(actor: Actor) {
  if (!encryptionAvailable()) throw new ServiceError("A verificação em duas etapas ainda não está configurada no servidor.", "STATE");
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (u.totpEnabledAt) throw new ServiceError("A verificação em duas etapas já está ligada.", "STATE");
  const secret = newSecret();
  await prisma.user.update({ where: { id: u.id }, data: { totpPendingEnc: encryptSecret(secret) } });
  const url = otpauthUrl(secret, u.email);
  const svg = await QRCode.toString(url, { type: "svg", margin: 1, width: 220, errorCorrectionLevel: "M" });
  return { secret, qr: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}` };
}

/** Passo 2 de ligar: o código do aplicativo confirma que ficou certo. Devolve os códigos de recuperação (mostrados uma vez só). */
export async function confirmTwoFactorSetup(actor: Actor, code: string, now = new Date()): Promise<string[]> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (u.totpEnabledAt) throw new ServiceError("A verificação em duas etapas já está ligada.", "STATE");
  const secret = u.totpPendingEnc ? decryptSecret(u.totpPendingEnc) : null;
  if (!secret) throw new ServiceError("Comece de novo: clique em Ligar verificação em duas etapas.", "STATE");
  const step = verifyCode(secret, code, now, null);
  if (step === null) throw new ServiceError("Código não confere. Confira se o horário do celular está automático e digite o código que aparece agora.");
  const codes = newRecoveryCodes();
  await prisma.user.update({
    where: { id: u.id },
    data: { totpSecretEnc: u.totpPendingEnc, totpPendingEnc: null, totpEnabledAt: now, totpLastStep: step, recoveryCodeHashes: codes.map(hashRecoveryCode) },
  });
  await audit(prisma, actor, { action: "user.2fa_enabled", entity: "user", entityId: u.id });
  return codes;
}

/** Confere código do aplicativo ou de recuperação. Gasta o que for usado. */
async function consumeSecondFactor(userId: string, code: string, now: Date): Promise<"app" | "recuperacao" | null> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const secret = u.totpSecretEnc ? decryptSecret(u.totpSecretEnc) : null;
  const digits = code.replace(/\D/g, "");
  if (secret && digits.length === 6 && /^\s*[\d\s]+\s*$/.test(code)) {
    const step = verifyCode(secret, digits, now, u.totpLastStep);
    if (step === null) return null;
    // só grava se ninguém usou um intervalo igual ou mais novo no meio
    const r = await prisma.user.updateMany({ where: { id: u.id, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] }, data: { totpLastStep: step } });
    return r.count === 1 ? "app" : null;
  }
  const h = hashRecoveryCode(code);
  if (!u.recoveryCodeHashes.includes(h)) return null;
  await prisma.user.update({ where: { id: u.id }, data: { recoveryCodeHashes: u.recoveryCodeHashes.filter((x) => x !== h) } });
  return "recuperacao";
}

export async function disableTwoFactor(actor: Actor, password: string, code: string, now = new Date()) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!u.totpEnabledAt) throw new ServiceError("A verificação em duas etapas já está desligada.", "STATE");
  if (!(await bcrypt.compare(password, u.passwordHash))) throw new ServiceError("Senha incorreta.", "FORBIDDEN");
  if (!(await consumeSecondFactor(u.id, code, now))) throw new ServiceError("Código não confere.", "FORBIDDEN");
  await prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] } });
  await audit(prisma, actor, { action: "user.2fa_disabled", entity: "user", entityId: u.id });
}

export async function regenerateRecoveryCodes(actor: Actor, code: string, now = new Date()): Promise<string[]> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!u.totpEnabledAt) throw new ServiceError("Ligue a verificação em duas etapas primeiro.", "STATE");
  if ((await consumeSecondFactor(u.id, code, now)) !== "app") throw new ServiceError("Digite o código atual do aplicativo.", "FORBIDDEN");
  const codes = newRecoveryCodes();
  await prisma.user.update({ where: { id: u.id }, data: { recoveryCodeHashes: codes.map(hashRecoveryCode) } });
  await audit(prisma, actor, { action: "user.2fa_recovery_regenerated", entity: "user", entityId: u.id });
  return codes;
}

/** O administrador desliga a verificação de alguém da equipe que perdeu o celular e os códigos. */
export async function adminResetTwoFactor(actor: Actor, userId: string) {
  assertCan(actor, "users.manage");
  const u = await prisma.user.findFirst({ where: { id: userId, restaurantId: actor.restaurantId } });
  if (!u) throw new ServiceError("Usuário não encontrado.", "NOT_FOUND");
  if (u.id === actor.userId) throw new ServiceError("Para desligar a sua, use Minha conta.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: null, totpPendingEnc: null, totpEnabledAt: null, totpLastStep: null, recoveryCodeHashes: [] } }),
    prisma.authSession.deleteMany({ where: { userId: u.id } }),
  ]);
  await audit(prisma, actor, { action: "user.2fa_reset_by_admin", entity: "user", entityId: u.id, newValue: { email: u.email } });
}

// ---------------------------------------------------------------------------
// Regra do restaurante: exigir de administradores e gerentes
// ---------------------------------------------------------------------------

/** Situação da regra numa unidade: ligada ou não e quem (administradores e gerentes) ainda não ligou a sua. */
export async function twoFactorPolicy(restaurantId: string) {
  const roles = { code: { in: TWO_FACTOR_POLICY_ROLES } };
  const [setting, people] = await Promise.all([
    prisma.setting.findUnique({ where: { restaurantId }, select: { requireTwoFactor: true } }),
    prisma.user.findMany({
      where: { active: true, OR: [{ restaurantId, role: roles }, { memberships: { some: { restaurantId, active: true, role: roles } } }] },
      select: { name: true, totpEnabledAt: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return {
    required: Boolean(setting?.requireTwoFactor),
    available: encryptionAvailable(),
    total: people.length,
    pending: people.filter((p) => !p.totpEnabledAt).map((p) => p.name),
  };
}

export async function setTwoFactorPolicy(actor: Actor, required: boolean) {
  assertCan(actor, "settings.manage");
  if (required) {
    if (!encryptionAvailable()) throw new ServiceError("A verificação em duas etapas ainda não está configurada no servidor.", "STATE");
    const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId }, select: { totpEnabledAt: true } });
    if (!me.totpEnabledAt) throw new ServiceError("Ligue a sua verificação em duas etapas antes, em Minha conta. Assim você não fica de fora.", "STATE");
  }
  const before = await prisma.setting.findUnique({ where: { restaurantId: actor.restaurantId }, select: { requireTwoFactor: true } });
  await prisma.$transaction(async (tx) => {
    await tx.setting.upsert({ where: { restaurantId: actor.restaurantId }, update: { requireTwoFactor: required }, create: { restaurantId: actor.restaurantId, closingRecipients: [], requireTwoFactor: required } });
    await audit(tx, actor, { action: "settings.2fa_policy", entity: "restaurant", entityId: actor.restaurantId, oldValue: { requireTwoFactor: Boolean(before?.requireTwoFactor) }, newValue: { requireTwoFactor: required } });
  });
}

// ---------------------------------------------------------------------------
// Segundo passo do login
// ---------------------------------------------------------------------------

/** Sessão que acertou a senha e espera o código. null se não existe, venceu ou já foi concluída. */
export async function pendingLogin(token: string | null | undefined) {
  if (!token) return null;
  const s = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { select: { name: true, active: true } } } });
  if (!s || !s.pendingTwoFactor || s.expiresAt <= new Date() || !s.user.active) return null;
  return { sessionId: s.id, name: s.user.name };
}

/**
 * Confere o código e libera a sessão. Troca o token (o cookie da etapa da senha deixa de valer) e
 * estende a validade para o tempo normal de login.
 */
export async function completeSecondStep(token: string | null | undefined, code: string, meta: { ip?: string | null } = {}, now = new Date()) {
  if (!token) throw new ServiceError("Entre com e-mail e senha de novo.", "FORBIDDEN");
  const s = await prisma.authSession.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!s || !s.pendingTwoFactor || s.expiresAt <= now || !s.user.active) throw new ServiceError("O tempo para digitar o código acabou. Entre com e-mail e senha de novo.", "FORBIDDEN");
  const u = s.user;
  const who = { userId: u.id, name: u.name, email: u.email, role: u.role.code as RoleCode, restaurantId: u.restaurantId, ip: meta.ip };
  const method = await consumeSecondFactor(u.id, code, now);
  if (!method) {
    const attempts = s.twoFactorAttempts + 1;
    if (attempts >= MAX_CODE_ATTEMPTS) await prisma.authSession.delete({ where: { id: s.id } }).catch(() => undefined);
    else await prisma.authSession.update({ where: { id: s.id }, data: { twoFactorAttempts: attempts } });
    await audit(prisma, null, { action: "login.2fa_failed", entity: "user", entityId: u.id, newValue: { attempts } });
    throw new ServiceError(attempts >= MAX_CODE_ATTEMPTS ? "Códigos errados demais. Entre com e-mail e senha de novo." : "Código não confere. Digite o código que aparece agora no aplicativo.", "FORBIDDEN");
  }
  const fresh = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.authSession.update({ where: { id: s.id }, data: { tokenHash: hashToken(fresh), pendingTwoFactor: false, twoFactorAttempts: 0, expiresAt, lastSeenAt: now } });
    await tx.user.update({ where: { id: u.id }, data: { lastLoginAt: now } });
    await audit(tx, who, { action: "login", entity: "user", entityId: u.id, newValue: { segundaEtapa: method } });
  });
  const left = method === "recuperacao" ? (await prisma.user.findUniqueOrThrow({ where: { id: u.id }, select: { recoveryCodeHashes: true } })).recoveryCodeHashes.length : null;
  return { userId: u.id, token: fresh, expiresAt, mustChangePassword: u.mustChangePassword, recoveryLeft: left };
}

// ---------------------------------------------------------------------------
// Sessões abertas da própria pessoa
// ---------------------------------------------------------------------------

export async function listMySessions(actor: Actor & { sessionId: string }) {
  const rows = await prisma.authSession.findMany({
    where: { userId: actor.userId, pendingTwoFactor: false, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, ip: true, userAgent: true },
  });
  return rows.map((r) => ({ ...r, current: r.id === actor.sessionId, ip: maskIp(r.ip), device: describeDevice(r.userAgent) }));
}

export async function revokeMySession(actor: Actor & { sessionId: string }, sessionId: string) {
  if (sessionId === actor.sessionId) throw new ServiceError("Para sair deste aparelho, use o botão Sair.");
  const r = await prisma.authSession.deleteMany({ where: { id: sessionId, userId: actor.userId } });
  if (r.count === 0) throw new ServiceError("Sessão não encontrada.", "NOT_FOUND");
  await audit(prisma, actor, { action: "session.revoked", entity: "user", entityId: actor.userId });
}

export async function revokeOtherSessions(actor: Actor & { sessionId: string }) {
  const r = await prisma.authSession.deleteMany({ where: { userId: actor.userId, id: { not: actor.sessionId } } });
  await audit(prisma, actor, { action: "session.revoked_others", entity: "user", entityId: actor.userId, newValue: { count: r.count } });
  return r.count;
}

/** Mostra só o começo do endereço: suficiente para reconhecer, sem expor. */
export function maskIp(ip: string | null): string {
  if (!ip) return "endereço desconhecido";
  if (ip.includes(".")) return ip.split(".").slice(0, 2).join(".") + ".x.x";
  return ip.split(":").slice(0, 2).join(":") + ":…";
}

export function describeDevice(ua: string | null): string {
  if (!ua) return "Aparelho desconhecido";
  const os = /iPad/.test(ua) ? "iPad" : /iPhone/.test(ua) ? "iPhone" : /Android/.test(ua) ? (/Mobile/.test(ua) ? "Celular Android" : "Tablet Android") : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "Mac" : /Linux/.test(ua) ? "Linux" : "Outro sistema";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "navegador";
  return `${br} no ${os}`;
}
