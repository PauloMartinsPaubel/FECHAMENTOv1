import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Actor } from "../actor";
import { ServiceError } from "../errors";
import type { RoleCode } from "@/lib/permissions";
import { BCRYPT_COST } from "../seed";

export const SESSION_HOURS = 12;
export const MAX_FAILED_LOGINS = 5;
export const LOCK_MINUTES = 15;

/** Hash real, gerado uma vez, para gastar o mesmo tempo quando o e-mail não existe (não revela quais e-mails existem). */
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= bcrypt.hash("senha-que-nunca-sera-usada", BCRYPT_COST));

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface LoginMeta {
  ip?: string | null;
  userAgent?: string | null;
  bcryptCost?: number;
}

export interface LoginResult {
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
}

export async function loginWithPassword(email: string, password: string, meta: LoginMeta = {}): Promise<LoginResult> {
  const normalized = email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email: normalized }, include: { role: true } });
  const fail = async (reason: string, userId?: string): Promise<never> => {
    await audit(prisma, null, {
      action: "login.failed",
      entity: "user",
      entityId: userId,
      newValue: { email: normalized, reason },
    });
    throw new ServiceError("E-mail ou senha inválidos.", "FORBIDDEN");
  };

  if (!user || !user.active) {
    await bcrypt.compare(password, await getDummyHash());
    return fail("usuario_inexistente_ou_inativo", user?.id);
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new ServiceError("Acesso bloqueado por tentativas incorretas. Tente novamente em alguns minutos.", "FORBIDDEN");
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLogins: lock ? 0 : failed,
        lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
      },
    });
    return fail(lock ? "senha_incorreta_bloqueado" : "senha_incorreta", user.id);
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_HOURS * 3600_000);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    await audit(
      tx,
      { userId: user.id, name: user.name, email: user.email, role: user.role.code, restaurantId: user.restaurantId, ip: meta.ip },
      { action: "login", entity: "user", entityId: user.id },
    );
  });
  return { token, expiresAt, mustChangePassword: user.mustChangePassword };
}

export interface CurrentUser extends Actor {
  mustChangePassword: boolean;
  sessionId: string;
}

/** Valida o token do cookie. Retorna null se não existir, expirou ou o usuário foi desativado. */
export async function userFromToken(token: string | undefined | null, ip?: string | null): Promise<CurrentUser | null> {
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  });
  if (!session) return null;
  if (session.expiresAt <= new Date() || !session.user.active) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const u = session.user;
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    role: u.role.code as RoleCode,
    restaurantId: u.restaurantId,
    ip: ip ?? null,
    mustChangePassword: u.mustChangePassword,
    sessionId: session.id,
  };
}

export async function logout(actor: Actor, token: string | undefined | null): Promise<void> {
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
  await audit(prisma, actor, { action: "logout", entity: "user", entityId: actor.userId });
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 8) return "A senha precisa ter ao menos 8 caracteres.";
  if (password.length > 200) return "A senha é longa demais.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Use letras e números na senha.";
  return null;
}

export async function changeOwnPassword(actor: Actor, currentPassword: string, newPassword: string, keepToken?: string | null) {
  const weak = validatePasswordStrength(newPassword);
  if (weak) throw new ServiceError(weak);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId } });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    throw new ServiceError("A senha atual está incorreta.", "FORBIDDEN");
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw new ServiceError("Escolha uma senha diferente da atual.");
  }
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: await bcrypt.hash(newPassword, BCRYPT_COST), mustChangePassword: false },
    });
    // encerra as outras sessões deste usuário
    await tx.authSession.deleteMany({
      where: { userId: user.id, ...(keepToken ? { tokenHash: { not: hashToken(keepToken) } } : {}) },
    });
    await audit(tx, actor, { action: "user.password_changed", entity: "user", entityId: user.id });
  });
}
