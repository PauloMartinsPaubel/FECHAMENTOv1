import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { audit } from "../audit";
import { ServiceError } from "../errors";
import { defaultFrom, sendMail } from "../email/provider";
import { BCRYPT_COST } from "../seed";
import { hashToken, validatePasswordStrength } from "./auth";
import type { RoleCode } from "@/lib/permissions";

/** O link vale por este tempo. */
export const RESET_MINUTES = 30;
/** Pedidos aceitos por usuário dentro de uma hora (o resto é ignorado em silêncio). */
export const MAX_RESETS_PER_HOUR = 3;

export interface ResetRequest {
  to: string;
  name: string;
  link: string;
}

/**
 * Cria o link de troca de senha. Devolve null quando não há o que enviar (e-mail desconhecido,
 * usuário desativado ou pedidos demais): quem chama mostra sempre a mesma mensagem, para não revelar
 * quais e-mails existem.
 */
export async function createPasswordReset(email: string, appUrl: string, meta: { ip?: string | null } = {}, now = new Date()): Promise<ResetRequest | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 200) return null;
  const user = await prisma.user.findUnique({ where: { email: normalized }, include: { role: true } });
  if (!user || !user.active) {
    await audit(prisma, null, { action: "password.reset_requested", entity: "user", newValue: { email: normalized, result: "ignorado" } });
    return null;
  }
  const recent = await prisma.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(now.getTime() - 3600_000) } } });
  if (recent >= MAX_RESETS_PER_HOUR) {
    await audit(prisma, null, { action: "password.reset_requested", entity: "user", entityId: user.id, newValue: { email: normalized, result: "limite" } });
    return null;
  }
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.create({
    data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + RESET_MINUTES * 60_000), ip: meta.ip ?? null, createdAt: now },
  });
  await audit(
    prisma,
    { userId: user.id, name: user.name, email: user.email, role: user.role.code as RoleCode, restaurantId: user.restaurantId, ip: meta.ip },
    { action: "password.reset_requested", entity: "user", entityId: user.id },
  );
  return { to: user.email, name: user.name, link: `${appUrl.replace(/\/$/, "")}/senha/nova?t=${encodeURIComponent(token)}` };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildResetEmail(r: ResetRequest) {
  const subject = "Troca de senha do Fechamento de Caixa";
  const text = [
    `Olá, ${r.name}.`,
    "",
    "Recebemos um pedido para trocar a sua senha. Para criar uma senha nova, abra o link abaixo:",
    r.link,
    "",
    `O link vale por ${RESET_MINUTES} minutos e só pode ser usado uma vez.`,
    "Se não foi você, ignore este e-mail: a sua senha continua a mesma.",
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1c1917;max-width:520px">
<p>Olá, ${esc(r.name)}.</p>
<p>Recebemos um pedido para trocar a sua senha. Para criar uma senha nova, clique no botão:</p>
<p><a href="${esc(r.link)}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Criar senha nova</a></p>
<p style="font-size:13px;color:#57534e">O link vale por ${RESET_MINUTES} minutos e só pode ser usado uma vez. Se não foi você, ignore este e-mail: a sua senha continua a mesma.</p>
</div>`;
  return { subject, text, html };
}

export async function sendPasswordResetEmail(r: ResetRequest, send = sendMail): Promise<void> {
  const { subject, text, html } = buildResetEmail(r);
  try {
    await send({ from: defaultFrom(null), to: [r.to], subject, text, html, attachments: [] });
  } catch (err) {
    console.error("recuperação de senha: falha no envio", err);
  }
}

async function findValid(token: string, now: Date) {
  if (!token || token.length > 200) return null;
  const r = await prisma.passwordReset.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: { include: { role: true } } } });
  if (!r || r.usedAt || r.expiresAt <= now || !r.user.active) return null;
  return r;
}

/** Para a tela do link: diz se ainda vale, sem gastar o link. */
export async function resetTokenIsValid(token: string, now = new Date()): Promise<boolean> {
  return (await findValid(token, now)) !== null;
}

/** Troca a senha pelo link. Gasta o link, invalida os outros pedidos e encerra todas as sessões abertas. */
export async function resetPasswordWithToken(token: string, password: string, confirm: string, meta: { ip?: string | null; bcryptCost?: number } = {}, now = new Date()) {
  const r = await findValid(token, now);
  if (!r) throw new ServiceError("Este link não vale mais. Peça um novo em \"Esqueci minha senha\".", "STATE");
  const weak = validatePasswordStrength(password);
  if (weak) throw new ServiceError(weak);
  if (password !== confirm) throw new ServiceError("A confirmação não confere com a senha.");
  const hash = await bcrypt.hash(password, meta.bcryptCost ?? BCRYPT_COST);
  await prisma.$transaction(async (tx) => {
    // marca como usado só se ninguém usou no meio (dois cliques ao mesmo tempo)
    const claimed = await tx.passwordReset.updateMany({ where: { id: r.id, usedAt: null }, data: { usedAt: now } });
    if (claimed.count === 0) throw new ServiceError("Este link já foi usado.", "STATE");
    await tx.passwordReset.updateMany({ where: { userId: r.userId, usedAt: null }, data: { usedAt: now } });
    await tx.user.update({ where: { id: r.userId }, data: { passwordHash: hash, mustChangePassword: false, failedLogins: 0, lockedUntil: null } });
    await tx.authSession.deleteMany({ where: { userId: r.userId } });
    await audit(
      tx,
      { userId: r.user.id, name: r.user.name, email: r.user.email, role: r.user.role.code as RoleCode, restaurantId: r.user.restaurantId, ip: meta.ip },
      { action: "password.reset_done", entity: "user", entityId: r.userId },
    );
  });
  return { email: r.user.email };
}
