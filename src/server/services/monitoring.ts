import { createHash } from "node:crypto";
import { prisma } from "../db";
import { defaultFrom, emailProvider, sendMail } from "../email/provider";
import { parseRecipients } from "./email";

/** Depois de avisar sobre um erro, espera este tempo antes de avisar de novo sobre o mesmo erro. */
export const NOTIFY_EVERY_MS = 60 * 60_000;

export interface ErrorReport {
  message: string;
  stack?: string | null;
  path?: string | null;
  kind?: string | null;
}

/** Assinatura do erro: mesma mensagem (sem números e ids) no mesmo lugar do código = mesmo erro. */
export function errorFingerprint(r: ErrorReport): string {
  const msg = r.message.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>").replace(/\d+/g, "<n>").slice(0, 300);
  const top = (r.stack ?? "").split("\n").find((l) => l.trim().startsWith("at ")) ?? "";
  const route = (r.path ?? "").replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, "<id>").split("?")[0];
  return createHash("sha256").update(`${msg}|${top.trim()}|${route}`).digest("hex").slice(0, 32);
}

export function opsRecipients(): string[] {
  return parseRecipients(process.env.OPS_ALERT_EMAIL ?? "");
}

/**
 * Guarda o erro (agrupado) e avisa o suporte por e-mail, no máximo uma vez por hora para o mesmo erro.
 * Nunca lança: monitoramento não pode derrubar a tela.
 */
export async function reportError(r: ErrorReport, now = new Date(), send = sendMail): Promise<{ notified: boolean }> {
  try {
    const fingerprint = errorFingerprint(r);
    const e = await prisma.errorEvent.upsert({
      where: { fingerprint },
      update: { count: { increment: 1 }, lastSeenAt: now, path: r.path ?? undefined },
      create: { fingerprint, message: r.message.slice(0, 2000), stack: r.stack?.slice(0, 8000) ?? null, path: r.path ?? null, kind: r.kind ?? null, firstSeenAt: now, lastSeenAt: now },
    });
    const to = opsRecipients();
    if (!to.length || emailProvider() === "none") return { notified: false };
    if (e.notifiedAt && now.getTime() - e.notifiedAt.getTime() < NOTIFY_EVERY_MS) return { notified: false };
    // marca antes de enviar, e só se ninguém marcou no meio: evita e-mail duplicado com erros simultâneos
    const claimed = await prisma.errorEvent.updateMany({
      where: { id: e.id, notifiedAt: e.notifiedAt },
      data: { notifiedAt: now },
    });
    if (claimed.count === 0) return { notified: false };
    const lines = [
      `Erro: ${e.message}`,
      `Onde: ${r.path ?? "-"} (${r.kind ?? "servidor"})`,
      `Vezes: ${e.count} desde ${e.firstSeenAt.toISOString()}`,
      "",
      (e.stack ?? "").split("\n").slice(0, 12).join("\n"),
    ];
    const text = lines.join("\n");
    await send({
      from: defaultFrom(null),
      to,
      subject: `[Fechamento de Caixa] Erro no sistema: ${e.message.slice(0, 80)}`,
      text,
      html: `<pre style="font-family:monospace;white-space:pre-wrap">${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</pre>`,
      attachments: [],
    });
    return { notified: true };
  } catch (err) {
    console.error("monitoramento: falha ao registrar erro", err);
    return { notified: false };
  }
}

/** Para monitor de disponibilidade externo: confirma que o servidor responde e o banco está acessível. */
export async function healthCheck(): Promise<{ ok: boolean; db: boolean; ms: number }> {
  const t = Date.now();
  const db = await prisma.$queryRaw`SELECT 1`.then(() => true).catch(() => false);
  return { ok: db, db, ms: Date.now() - t };
}
