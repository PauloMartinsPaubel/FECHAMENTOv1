import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { audit } from "../audit";
import type { Actor } from "../actor";
import { ServiceError } from "../errors";
import type { RoleCode } from "@/lib/permissions";
import { BCRYPT_COST } from "../seed";
import { encryptionAvailable } from "../security/totp";

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
  userId: string;
  token: string;
  expiresAt: Date;
  mustChangePassword: boolean;
  /** senha certa, mas a pessoa ligou a verificação em duas etapas: falta o código */
  pendingTwoFactor: boolean;
}

/** Tempo para digitar o código depois de acertar a senha. */
const SECOND_STEP_MS = 10 * 60_000;

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
  const pendingTwoFactor = Boolean(user.totpEnabledAt);
  // com a verificação em duas etapas, a sessão nasce sem acesso e vale só alguns minutos, até o código
  const expiresAt = new Date(Date.now() + (pendingTwoFactor ? SECOND_STEP_MS : SESSION_HOURS * 3600_000));
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, ...(pendingTwoFactor ? {} : { lastLoginAt: new Date() }) },
    });
    await tx.authSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt,
        pendingTwoFactor,
        ip: meta.ip ?? undefined,
        userAgent: meta.userAgent?.slice(0, 300),
      },
    });
    await audit(
      tx,
      { userId: user.id, name: user.name, email: user.email, role: user.role.code, restaurantId: user.restaurantId, ip: meta.ip },
      { action: pendingTwoFactor ? "login.password_ok" : "login", entity: "user", entityId: user.id },
    );
  });
  return { userId: user.id, token, expiresAt, mustChangePassword: user.mustChangePassword, pendingTwoFactor };
}

export interface CurrentUser extends Actor {
  mustChangePassword: boolean;
  /** o restaurante exige a verificação em duas etapas deste papel e a pessoa ainda não ligou */
  mustSetupTwoFactor: boolean;
  sessionId: string;
}

/** Papéis que a opção "exigir verificação em duas etapas" alcança. */
export const TWO_FACTOR_POLICY_ROLES: RoleCode[] = ["ADMIN", "MANAGER"];

/** Valida o token do cookie. Retorna null se não existir, expirou ou o usuário foi desativado. */
export async function userFromToken(token: string | undefined | null, ip?: string | null): Promise<CurrentUser | null> {
  if (!token) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { role: true } } },
  });
  if (!session) return null;
  // acertou a senha mas ainda não digitou o código: não dá acesso a nada
  if (session.pendingTwoFactor) return null;
  if (session.expiresAt <= new Date() || !session.user.active) {
    await prisma.authSession.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }
  const u = session.user;
  // unidade escolhida no seletor: vale se o acesso a ela continua ativo; senão, volta para a principal
  let restaurantId = u.restaurantId;
  let role = u.role.code as RoleCode;
  if (session.activeRestaurantId && session.activeRestaurantId !== u.restaurantId) {
    const m = await prisma.membership.findUnique({
      where: { userId_restaurantId: { userId: u.id, restaurantId: session.activeRestaurantId } },
      include: { role: true },
    });
    if (m?.active) {
      restaurantId = m.restaurantId;
      role = m.role.code as RoleCode;
    }
  }
  // só consulta a regra do restaurante quando ela poderia valer para esta pessoa
  let mustSetupTwoFactor = false;
  if (!u.totpEnabledAt && TWO_FACTOR_POLICY_ROLES.includes(role) && encryptionAvailable()) {
    const s = await prisma.setting.findUnique({ where: { restaurantId }, select: { requireTwoFactor: true } });
    mustSetupTwoFactor = Boolean(s?.requireTwoFactor);
  }
  return {
    userId: u.id,
    name: u.name,
    email: u.email,
    role,
    restaurantId,
    ip: ip ?? null,
    mustChangePassword: u.mustChangePassword,
    mustSetupTwoFactor,
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
