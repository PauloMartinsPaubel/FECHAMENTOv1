import { createHash } from "node:crypto";
import { formatDateTimeBR } from "@/lib/dates";
import type { RoleCode } from "@/lib/permissions";
import { audit } from "../audit";
import { prisma } from "../db";
import { defaultFrom, sendMail } from "../email/provider";
import { describeDevice, maskIp } from "./two-factor";

/** Aparelho sem uso há mais tempo que isso sai da lista (volta a avisar se aparecer de novo). */
export const FORGET_DEVICE_DAYS = 180;

const hashKey = (key: string) => createHash("sha256").update(`aparelho:${key}`).digest("hex");

export interface DeviceLogin {
  userId: string;
  /** identificador aleatório guardado no cookie do aparelho */
  deviceKey: string;
  userAgent?: string | null;
  ip?: string | null;
}

/**
 * Registra o aparelho do login. Devolve true quando é um aparelho novo de quem já tinha aparelho
 * conhecido. O primeiro aparelho de cada pessoa só é registrado: não faz sentido avisar do primeiro
 * acesso, nem disparar e-mail para todo mundo quando o aviso começou a funcionar.
 */
export async function noteDevice(d: DeviceLogin, now = new Date()): Promise<boolean> {
  const keyHash = hashKey(d.deviceKey);
  const label = describeDevice(d.userAgent ?? null);
  const cutoff = new Date(now.getTime() - FORGET_DEVICE_DAYS * 86_400_000);
  const seen = await prisma.knownDevice.updateMany({ where: { userId: d.userId, keyHash, lastSeenAt: { gte: cutoff } }, data: { lastSeenAt: now, label } });
  if (seen.count > 0) return false;
  await prisma.knownDevice.deleteMany({ where: { userId: d.userId, lastSeenAt: { lt: cutoff } } });
  const before = await prisma.knownDevice.count({ where: { userId: d.userId } });
  try {
    await prisma.knownDevice.create({ data: { userId: d.userId, keyHash, label, firstSeenAt: now, lastSeenAt: now } });
  } catch {
    // dois logins ao mesmo tempo no mesmo aparelho: o outro já registrou
    return false;
  }
  return before > 0;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function buildNewDeviceEmail(p: { name: string; device: string; when: string; ip: string; accountUrl: string; twoFactor: boolean }) {
  const subject = "Novo acesso à sua conta do Fechamento de Caixa";
  const tip = p.twoFactor ? "" : "Para mais proteção, ligue a verificação em duas etapas em Minha conta.";
  const text = [
    `Olá, ${p.name}.`,
    "",
    "A sua conta acabou de ser aberta num aparelho que ainda não tinha sido usado:",
    `${p.device}, em ${p.when}, endereço ${p.ip}.`,
    "",
    "Se foi você, não precisa fazer nada.",
    "Se não foi, entre agora, troque a senha e encerre os outros aparelhos em Minha conta:",
    p.accountUrl,
    "Se não conseguir entrar, use Esqueci a senha na tela de login.",
    ...(tip ? ["", tip] : []),
  ].join("\n");
  const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1c1917;max-width:520px">
<p>Olá, ${esc(p.name)}.</p>
<p>A sua conta acabou de ser aberta num aparelho que ainda não tinha sido usado:</p>
<p style="background:#f5f5f4;border-radius:8px;padding:12px 16px"><strong>${esc(p.device)}</strong><br>${esc(p.when)} · endereço ${esc(p.ip)}</p>
<p>Se foi você, não precisa fazer nada.</p>
<p>Se não foi, entre agora, troque a senha e encerre os outros aparelhos:</p>
<p><a href="${esc(p.accountUrl)}" style="display:inline-block;background:#15803d;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Abrir Minha conta</a></p>
<p style="font-size:13px;color:#57534e">Se não conseguir entrar, use Esqueci a senha na tela de login.${tip ? ` ${esc(tip)}` : ""}</p>
</div>`;
  return { subject, text, html };
}

/** Chamado depois de cada login completo (com o código, se a pessoa usa duas etapas). Nunca derruba o login. */
export async function handleLoginDevice(d: DeviceLogin, appUrl: string, send = sendMail, now = new Date()): Promise<boolean> {
  try {
    if (!(await noteDevice(d, now))) return false;
    const u = await prisma.user.findUniqueOrThrow({ where: { id: d.userId }, include: { role: true } });
    const device = describeDevice(d.userAgent ?? null);
    const ip = maskIp(d.ip ?? null);
    const { subject, text, html } = buildNewDeviceEmail({
      name: u.name,
      device,
      when: formatDateTimeBR(now),
      ip,
      accountUrl: `${appUrl.replace(/\/$/, "")}/conta`,
      twoFactor: Boolean(u.totpEnabledAt),
    });
    let sent = true;
    try {
      await send({ from: defaultFrom(null), to: [u.email], subject, text, html, attachments: [] });
    } catch (err) {
      sent = false;
      console.error("aviso de aparelho novo: falha no envio", err);
    }
    await audit(
      prisma,
      { userId: u.id, name: u.name, email: u.email, role: u.role.code as RoleCode, restaurantId: u.restaurantId, ip: d.ip ?? null },
      { action: "login.new_device", entity: "user", entityId: u.id, newValue: { aparelho: device, endereco: ip, avisoEnviado: sent } },
    );
    return true;
  } catch (err) {
    console.error("aviso de aparelho novo", err);
    return false;
  }
}
