import { formatDateBR, formatDateTimeBR } from "@/lib/dates";
import { formatBRL, formatSigned } from "@/lib/finance";
import { esc } from "@/lib/reports/html";
import { statusText } from "@/lib/reports/labels";
import type { ShiftReportData } from "@/lib/reports/types";
import type { Actor } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { defaultFrom, sendMail } from "../email/provider";
import { errorMessage } from "../errors";
import { getSettings } from "../loaders";

export type AlertOutcome =
  | { sent: true; to: string[] }
  | { sent: false; reason: "off" | "below" | "already" | "not_closed" | "failed"; error?: string };

/** A partir de quanto alertar: o valor configurado ou, se não houver, a tolerância de justificativa. */
export function alertThreshold(settings: { toleranceCents: number; alertThresholdCents: number | null }): number {
  return settings.alertThresholdCents ?? settings.toleranceCents;
}

export function buildAlertContent(d: ShiftReportData, appUrl: string, closingId: string, thresholdCents: number) {
  const div = d.divergence;
  const result = statusText(div.status, div.netCents, div.absCents);
  const when = formatDateBR(d.session.businessDate);
  const corrected = d.session.revision > 1;
  const headline =
    div.status === "FALTA" ? `faltando ${formatBRL(Math.abs(div.netCents))}` : div.status === "SOBRA" ? `sobrando ${formatBRL(Math.abs(div.netCents))}` : `com diferença de ${formatBRL(div.absCents)}`;
  const subject = `Alerta: ${d.session.registerName} · ${d.session.shiftName} de ${when} ${corrected ? "foi corrigido" : "fechou"} ${headline}`;
  const link = `${appUrl.replace(/\/$/, "")}/historico/${closingId}`;

  const lines: [string, string][] = [
    ["Caixa", `${d.session.registerName} · ${d.session.shiftName}`],
    ["Dia", when],
    ["Responsável pelo caixa", d.session.responsibleName],
    ["Fechado por", `${d.session.closedByName ?? "-"}${d.session.closedAt ? ` em ${formatDateTimeBR(d.session.closedAt)}` : ""}`],
    ["Resultado", result],
    ["Divergência líquida", formatSigned(div.netCents)],
    ["Soma das diferenças", formatBRL(div.absCents)],
    ["Limite do alerta", formatBRL(thresholdCents)],
  ];
  if (corrected) lines.push(["Situação", `Fechamento corrigido (revisão ${d.session.revision})`]);
  const origins = div.origins.map((o) => [o.label, formatSigned(o.differenceCents)] as [string, string]);
  const justification = d.justification?.trim() || "Sem justificativa.";

  const text = [
    `Alerta de divergência - ${d.restaurantName}`,
    "",
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    "De onde vem a diferença:",
    ...(origins.length ? origins.map(([k, v]) => `- ${k}: ${v}`) : ["- (sem detalhe)"]),
    "",
    `Justificativa: ${justification}`,
    "",
    `Relatório completo: ${link}`,
  ].join("\n");

  const td = "padding:6px 0;border-bottom:1px solid #e7e5e4";
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;background:#f5f5f4;padding:16px">
<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #fca5a5;border-radius:8px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px;color:#b91c1c">Alerta de divergência no caixa</h2>
<p style="margin:0 0 16px;color:#57534e">${esc(d.restaurantName)}</p>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${lines.map(([k, v]) => `<tr><td style="${td};color:#57534e">${esc(k)}</td><td style="${td};text-align:right;font-weight:${k === "Resultado" ? "700" : "400"}">${esc(v)}</td></tr>`).join("")}
</table>
<h3 style="margin:16px 0 4px;font-size:14px">De onde vem a diferença</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">
${origins.length ? origins.map(([k, v]) => `<tr><td style="${td}">${esc(k)}</td><td style="${td};text-align:right">${esc(v)}</td></tr>`).join("") : `<tr><td style="${td};color:#78716c">Sem detalhe.</td></tr>`}
</table>
<h3 style="margin:16px 0 4px;font-size:14px">Justificativa de quem fechou</h3>
<p style="margin:0;font-size:14px">${esc(justification)}</p>
<p style="margin:16px 0 0"><a href="${esc(link)}" style="color:#1d4ed8">Abrir o relatório completo no sistema</a></p>
<p style="margin:8px 0 0;color:#78716c;font-size:12px">Você recebe este alerta porque está na lista de alertas de divergência em Configurações.</p>
</div></body></html>`;

  return { subject, html, text };
}

/**
 * Depois de um fechamento, avisa por e-mail quem está na lista de alertas se a soma das diferenças
 * passou do limite. Nunca lança erro: o fechamento já está salvo e não depende do alerta.
 * Um alerta por revisão do fechamento (fechar, reabrir e fechar de novo gera outro).
 */
export async function sendDivergenceAlert(actor: Actor, sessionId: string): Promise<AlertOutcome> {
  try {
    const closing = await prisma.cashClosing.findFirst({ where: { sessionId, restaurantId: actor.restaurantId } });
    if (!closing) return { sent: false, reason: "not_closed" };
    const settings = await getSettings(prisma, actor.restaurantId);
    if (settings.alertRecipients.length === 0) return { sent: false, reason: "off" };
    const threshold = alertThreshold(settings);
    if (closing.absDiffCents <= threshold) return { sent: false, reason: "below" };

    const already = await prisma.auditLog.findFirst({
      where: { action: "alert.divergence.sent", entityId: closing.id, newValue: { path: ["revision"], equals: closing.revision } },
    });
    if (already) return { sent: false, reason: "already" };

    const data = closing.snapshot as unknown as ShiftReportData;
    const { subject, html, text } = buildAlertContent(data, process.env.APP_URL || "http://localhost:3000", closing.id, threshold);
    try {
      await sendMail({ from: defaultFrom(settings.emailFrom), to: settings.alertRecipients, subject, html, text, attachments: [] });
    } catch (err) {
      const error = errorMessage(err).slice(0, 500);
      await audit(prisma, actor, {
        action: "alert.divergence.failed",
        entity: "cash_closing",
        entityId: closing.id,
        sessionId,
        newValue: { to: settings.alertRecipients, revision: closing.revision, absDiff: formatBRL(closing.absDiffCents), error },
      });
      return { sent: false, reason: "failed", error };
    }
    await audit(prisma, actor, {
      action: "alert.divergence.sent",
      entity: "cash_closing",
      entityId: closing.id,
      sessionId,
      newValue: { to: settings.alertRecipients, revision: closing.revision, absDiff: formatBRL(closing.absDiffCents), threshold: formatBRL(threshold), subject },
    });
    return { sent: true, to: settings.alertRecipients };
  } catch (err) {
    return { sent: false, reason: "failed", error: errorMessage(err).slice(0, 500) };
  }
}
