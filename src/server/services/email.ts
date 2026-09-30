import { formatDateBR, formatDateTimeBR } from "@/lib/dates";
import { formatBRL, formatSigned } from "@/lib/finance";
import { esc, renderShiftReport, wrapDocument } from "@/lib/reports/html";
import { statusText } from "@/lib/reports/labels";
import type { ShiftReportData } from "@/lib/reports/types";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { defaultFrom, sendMail } from "../email/provider";
import { errorMessage, ServiceError } from "../errors";
import { getSettings } from "../loaders";
import { listCorrections } from "./queries";
import { assertSessionAccess } from "./sessions";

const EMAIL_RE = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]+$/;
const MAX_RECIPIENTS = 10;

export function parseRecipients(raw: string | string[] | null | undefined): string[] {
  const list = Array.isArray(raw) ? raw : (raw ?? "").split(/[\s,;]+/);
  const cleaned = [...new Set(list.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  const bad = cleaned.find((e) => !EMAIL_RE.test(e));
  if (bad) throw new ServiceError(`E-mail inválido: ${bad}`);
  if (cleaned.length > MAX_RECIPIENTS) throw new ServiceError(`Máximo de ${MAX_RECIPIENTS} destinatários.`);
  return cleaned;
}

export function buildEmailContent(d: ShiftReportData, appUrl: string, closingId: string) {
  const t = d.totals;
  const cash = d.salesByKind.find((k) => k.kind === "CASH")?.netCents ?? 0;
  const pix = d.salesByKind.find((k) => k.kind === "PIX")?.netCents ?? 0;
  const tickets = d.salesByKind.find((k) => k.kind === "TICKET")?.netCents ?? 0;
  const result = statusText(d.divergence.status, d.divergence.netCents, d.divergence.absCents);
  const subject = `Fechamento de caixa ${formatDateBR(d.session.businessDate)} - ${d.session.shiftName} - ${result.split(":")[0]}`;
  const link = `${appUrl.replace(/\/$/, "")}/historico/${closingId}`;

  const lines: [string, string][] = [
    ["Data", formatDateBR(d.session.businessDate)],
    ["Turno", d.session.shiftName],
    ["Caixa", d.session.registerName],
    ["Responsável", d.session.responsibleName],
    ["Faturamento", formatBRL(t.revenueCents)],
    ["Dinheiro", formatBRL(cash)],
    ["Cartões", formatBRL(t.cardsCents)],
    ["PIX", formatBRL(pix)],
    ["Tickets", formatBRL(tickets)],
    ["Fundo inicial (não é faturamento)", formatBRL(d.floatCents)],
    ["Divergência", formatSigned(d.divergence.netCents)],
    ["Resultado", result],
    ["Observações", d.notes || d.justification || "Nenhuma"],
  ];

  const text = [
    `Fechamento de caixa - ${d.restaurantName}`,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    `Relatório completo: ${link}`,
    "O relatório completo também segue em anexo (HTML, pronto para imprimir ou salvar em PDF).",
  ].join("\n");

  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;background:#f5f5f4;padding:16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d6d3d1;border-radius:8px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px">Fechamento de caixa</h2>
<p style="margin:0 0 16px;color:#57534e">${esc(d.restaurantName)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${lines
  .map(
    ([k, v]) =>
      `<tr><td style="padding:6px 0;border-bottom:1px solid #e7e5e4;color:#57534e">${esc(k)}</td><td style="padding:6px 0;border-bottom:1px solid #e7e5e4;text-align:right;font-weight:${k === "Faturamento" || k === "Resultado" ? "700" : "400"}">${esc(v)}</td></tr>`,
  )
  .join("")}
</table>
<p style="margin:16px 0 0"><a href="${esc(link)}" style="color:#1d4ed8">Abrir o relatório completo no sistema</a></p>
<p style="margin:8px 0 0;color:#78716c;font-size:12px">O relatório completo segue em anexo. Gerado em ${esc(formatDateTimeBR(new Date()))}.</p>
</div></body></html>`;

  return { subject, html, text };
}

export interface SendResult {
  ok: boolean;
  emailLogId: string;
  error?: string;
  attempt: number;
}

/**
 * Envia o relatório de um caixa JÁ FECHADO. O fechamento foi salvo antes e não muda aqui:
 * se o envio falhar, fica registrado e dá para reenviar quantas vezes precisar.
 */
export async function sendClosingEmail(actor: Actor, sessionId: string, recipientsInput?: string | string[] | null): Promise<SendResult> {
  assertCan(actor, "session.email");
  const session = await prisma.cashSession.findFirst({ where: { id: sessionId, restaurantId: actor.restaurantId }, include: { closing: true } });
  if (!session) throw new ServiceError("Caixa não encontrado.", "NOT_FOUND");
  assertSessionAccess(actor, session);
  if (!session.closing || (session.status !== "CLOSED" && session.status !== "CORRECTED")) {
    throw new ServiceError("Feche o caixa antes de enviar o relatório.", "STATE");
  }
  const closing = session.closing;

  const settings = await getSettings(prisma, actor.restaurantId);
  const recipients = parseRecipients(recipientsInput && recipientsInput.length ? recipientsInput : settings.closingRecipients);
  if (recipients.length === 0) {
    throw new ServiceError("Nenhum destinatário. Informe o e-mail do responsável aqui ou cadastre em Configurações.");
  }

  const data = closing.snapshot as unknown as ShiftReportData;
  const corrections = await listCorrections(prisma, actor.restaurantId, sessionId);
  const { subject, html, text } = buildEmailContent(data, process.env.APP_URL || "http://localhost:3000", closing.id);
  const attempt = (await prisma.emailLog.count({ where: { closingId: closing.id } })) + 1;

  const log = await prisma.emailLog.create({
    data: { restaurantId: actor.restaurantId, closingId: closing.id, sessionId, toEmails: recipients, subject, status: "PENDING", attempt, createdById: actor.userId },
  });

  try {
    const res = await sendMail({
      from: defaultFrom(settings.emailFrom),
      to: recipients,
      subject,
      html,
      text,
      attachments: [
        {
          filename: `fechamento-${data.session.businessDate}-${data.session.shiftCode.toLowerCase()}.html`,
          content: wrapDocument(`Fechamento ${formatDateBR(data.session.businessDate)} ${data.session.shiftName}`, renderShiftReport(data, corrections)),
          contentType: "text/html; charset=utf-8",
        },
      ],
    });
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: "SENT", sentAt: new Date(), providerMessageId: res.messageId } });
    await audit(prisma, actor, {
      action: "email.send",
      entity: "cash_closing",
      entityId: closing.id,
      sessionId,
      newValue: { to: recipients, subject, attempt },
    });
    return { ok: true, emailLogId: log.id, attempt };
  } catch (err) {
    const message = err instanceof ServiceError ? err.message : errorMessage(err);
    await prisma.emailLog.update({ where: { id: log.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    await audit(prisma, actor, {
      action: "email.failed",
      entity: "cash_closing",
      entityId: closing.id,
      sessionId,
      newValue: { to: recipients, subject, attempt, error: message.slice(0, 500) },
    });
    return { ok: false, emailLogId: log.id, error: message, attempt };
  }
}
