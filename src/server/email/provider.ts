import nodemailer from "nodemailer";
import { ServiceError } from "../errors";

export interface MailAttachment {
  filename: string;
  content: string | Buffer;
  contentType: string;
}

export interface MailMessage {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
  attachments: MailAttachment[];
}

export function emailProvider(): "smtp" | "resend" | "none" {
  const p = (process.env.EMAIL_PROVIDER || "none").toLowerCase();
  return p === "smtp" || p === "resend" ? p : "none";
}

export function defaultFrom(custom?: string | null): string {
  return custom || process.env.EMAIL_FROM || "Fechamento de Caixa <caixa@localhost>";
}

/** Envia pelo provedor configurado. Lança ServiceError com mensagem clara se não estiver configurado ou se falhar. */
export async function sendMail(msg: MailMessage): Promise<{ messageId: string | null }> {
  const provider = emailProvider();

  if (provider === "smtp") {
    const host = process.env.SMTP_HOST;
    if (!host) throw new ServiceError("SMTP_HOST não configurado. O fechamento está salvo; configure o e-mail e use Reenviar.", "STATE");
    const transport = nodemailer.createTransport({
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
    try {
      const info = await transport.sendMail({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
      });
      return { messageId: info.messageId ?? null };
    } catch (err) {
      throw new ServiceError(`O servidor de e-mail recusou o envio: ${(err as Error).message}`, "STATE");
    }
  }

  if (provider === "resend") {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new ServiceError("RESEND_API_KEY não configurada. O fechamento está salvo; configure o e-mail e use Reenviar.", "STATE");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: msg.from,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        attachments: msg.attachments.map((a) => ({ filename: a.filename, content: (Buffer.isBuffer(a.content) ? a.content : Buffer.from(a.content, "utf8")).toString("base64") })),
      }),
      signal: AbortSignal.timeout(30_000),
    }).catch((err: Error) => {
      throw new ServiceError(`Não foi possível falar com o Resend: ${err.message}`, "STATE");
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) throw new ServiceError(`O Resend recusou o envio: ${body.message ?? res.status}`, "STATE");
    return { messageId: body.id ?? null };
  }

  throw new ServiceError(
    "Envio de e-mail não configurado (EMAIL_PROVIDER). O fechamento está salvo; configure o e-mail e use Reenviar.",
    "STATE",
  );
}
