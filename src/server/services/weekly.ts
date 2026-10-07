import { addDays, formatDateBR, fromDbDate, startOfWeek, toDbDate, todayIso } from "@/lib/dates";
import { type ClosingStatus, formatBRL, formatSigned } from "@/lib/finance";
import { esc } from "@/lib/reports/html";
import { statusShort } from "@/lib/reports/labels";
import type { Prisma } from "@/generated/prisma/client";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { defaultFrom, sendMail } from "../email/provider";
import { errorMessage, ServiceError } from "../errors";
import { getSettings } from "../loaders";
import { buildPeriodReport, type PeriodReport } from "./queries";

/** Semana anterior completa (segunda a domingo) em relação a `today`. */
export function previousWeek(today: string): { from: string; to: string } {
  const from = addDays(startOfWeek(today), -7);
  return { from, to: addDays(from, 6) };
}

const short = (iso: string) => formatDateBR(iso).slice(0, 5);

export function percentChange(current: number, previous: number): string {
  if (previous <= 0) return "sem base de comparação";
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(pct * 10) / 10;
  if (rounded === 0) return "igual à semana anterior";
  return `${rounded > 0 ? "+" : ""}${rounded.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}% sobre a semana anterior`;
}

export interface NotClosedSession {
  date: string;
  shiftName: string;
  registerName: string;
  status: string;
}

export interface WeeklyInput {
  restaurantName: string;
  week: { from: string; to: string };
  current: PeriodReport;
  previousRevenueCents: number;
  notClosed: NotClosedSession[];
  appUrl: string;
}

type Section = { title: string; rows: [string, string][]; empty?: string };

/** Monta o e-mail do resumo semanal (texto e HTML). Puro: recebe os números prontos. */
export function buildWeeklyContent(input: WeeklyInput) {
  const { current: r, week } = input;
  const t = r.totals;
  const change = percentChange(t.revenueCents, input.previousRevenueCents);
  const subject = `Resumo semanal ${short(week.from)} a ${short(week.to)}: faturamento ${formatBRL(t.revenueCents)} (${change})`;
  const link = `${input.appUrl.replace(/\/$/, "")}/relatorios?from=${week.from}&to=${week.to}`;
  const pctOf = (v: number) => (t.revenueCents > 0 ? ` (${Math.round((v / t.revenueCents) * 100)}%)` : "");
  const daysWithSales = r.byDay.filter((d) => d.headline.revenueCents !== 0).length;

  // divergência por responsável: quem mais fechou com diferença
  const byPerson = new Map<string, { count: number; abs: number; net: number }>();
  for (const d of r.divergences) {
    const p = byPerson.get(d.responsibleName) ?? { count: 0, abs: 0, net: 0 };
    p.count++;
    p.abs += d.absCents;
    p.net += d.netCents;
    byPerson.set(d.responsibleName, p);
  }
  const people = [...byPerson.entries()].sort((a, b) => b[1].abs - a[1].abs).slice(0, 5);
  const worst = [...r.divergences].sort((a, b) => b.absCents - a.absCents).slice(0, 5);

  const sections: Section[] = [
    {
      title: "Faturamento",
      rows: [
        ["Total da semana", formatBRL(t.revenueCents)],
        ["Comparação", change],
        ["Média por dia com venda", daysWithSales ? formatBRL(Math.round(t.revenueCents / daysWithSales)) : "-"],
        ["Caixas fechados", String(r.sessionCount)],
      ],
    },
    {
      title: "Por forma de pagamento",
      rows: (
        [
          ["Dinheiro", t.cashSalesCents],
          ["Cartões", t.cardsCents],
          ["PIX", t.pixCents],
          ["Tickets / vales", t.ticketsCents],
          ["Online (plataformas)", t.onlineCents],
          ["Outros", t.otherCents],
        ] as [string, number][]
      )
        .filter(([, v]) => v !== 0)
        .map(([k, v]) => [k, `${formatBRL(v)}${pctOf(v)}`]),
      empty: "Sem vendas.",
    },
    { title: "Por canal", rows: r.byChannel.filter((c) => c.netCents !== 0).map((c) => [c.name, `${formatBRL(c.netCents)}${pctOf(c.netCents)}`]), empty: "Sem vendas." },
    { title: "Por turno", rows: r.byShift.map((s) => [s.label, formatBRL(s.headline.revenueCents)]), empty: "Sem caixas fechados." },
    {
      title: "Conferência",
      rows: [
        ["Caixas corretos", String(r.sessionCount - r.divergences.length)],
        ["Caixas com diferença", String(r.divergences.length)],
        ["Divergência líquida", formatSigned(t.divergenceNetCents)],
        ["Soma das diferenças", formatBRL(t.divergenceAbsCents)],
      ],
    },
    {
      title: "Maiores diferenças",
      rows: worst.map((d) => [
        `${short(d.date)} ${d.shiftName} · ${d.registerName} (${d.responsibleName})`,
        `${statusShort(d.status as ClosingStatus | null)} ${formatSigned(d.netCents)}${d.justification ? `. ${d.justification}` : ""}`,
      ]),
      empty: "Nenhum caixa com diferença.",
    },
    {
      title: "Diferenças por responsável",
      rows: people.map(([name, p]) => [name, `${p.count} caixa(s), soma ${formatBRL(p.abs)} (líquido ${formatSigned(p.net)})`]),
      empty: "Ninguém fechou com diferença.",
    },
    {
      title: "Cancelamentos",
      rows: [["Pedidos cancelados", `${t.cancellationsCount} (${formatBRL(t.cancellationsCents)}, fora do faturamento)`]],
    },
  ];
  if (input.notClosed.length) {
    sections.push({
      title: "Atenção: caixas que não foram fechados",
      rows: input.notClosed.map((s) => [`${short(s.date)} ${s.shiftName} · ${s.registerName}`, s.status]),
    });
  }

  const text = [
    `Resumo semanal - ${input.restaurantName}`,
    `Semana de ${formatDateBR(week.from)} a ${formatDateBR(week.to)}`,
    "",
    ...sections.flatMap((s) => [s.title.toUpperCase(), ...(s.rows.length ? s.rows.map(([k, v]) => `${k}: ${v}`) : [s.empty ?? "-"]), ""]),
    `Relatório completo do período: ${link}`,
    "O faturamento não inclui o fundo de caixa.",
  ].join("\n");

  const td = "padding:5px 0;border-bottom:1px solid #e7e5e4;vertical-align:top";
  const html = `<!doctype html><html lang="pt-BR"><body style="font-family:Arial,Helvetica,sans-serif;color:#1c1917;background:#f5f5f4;padding:16px">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #d6d3d1;border-radius:8px;padding:20px">
<h2 style="margin:0 0 4px;font-size:18px">Resumo semanal</h2>
<p style="margin:0 0 4px;color:#57534e">${esc(input.restaurantName)} · ${esc(formatDateBR(week.from))} a ${esc(formatDateBR(week.to))}</p>
<p style="margin:12px 0;font-size:24px;font-weight:700">${esc(formatBRL(t.revenueCents))} <span style="font-size:14px;font-weight:400;color:#57534e">${esc(change)}</span></p>
${sections
  .map(
    (s) => `<h3 style="margin:18px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:${s.title.startsWith("Atenção") ? "#b91c1c" : "#44403c"}">${esc(s.title)}</h3>
<table style="width:100%;border-collapse:collapse;font-size:14px">${
      s.rows.length
        ? s.rows.map(([k, v]) => `<tr><td style="${td};color:#57534e">${esc(k)}</td><td style="${td};text-align:right">${esc(v)}</td></tr>`).join("")
        : `<tr><td style="${td};color:#78716c">${esc(s.empty ?? "-")}</td></tr>`
    }</table>`,
  )
  .join("\n")}
<p style="margin:18px 0 0"><a href="${esc(link)}" style="color:#1d4ed8">Abrir o relatório completo da semana</a></p>
<p style="margin:8px 0 0;color:#78716c;font-size:12px">O faturamento não inclui o fundo de caixa. Você recebe este resumo porque está na lista do resumo semanal em Configurações.</p>
</div></body></html>`;

  return { subject, text, html };
}

function systemActor(restaurantId: string): Actor {
  return { userId: "sistema", name: "Resumo semanal", email: "", role: "ADMIN", restaurantId };
}

export type WeeklyOutcome =
  | { sent: true; to: string[]; week: { from: string; to: string } }
  | { sent: false; reason: "off" | "already" | "failed"; week: { from: string; to: string }; error?: string };

/**
 * Monta e envia o resumo da semana anterior de um restaurante.
 * `manual`: quem pediu pelo botão (manda mesmo que o automático já tenha ido). Sem `manual`, é o agendamento:
 * manda uma vez por semana e por restaurante, mesmo que seja chamado de novo.
 */
export async function sendWeeklySummary(
  restaurantId: string,
  options: { today?: string; manual?: Actor } = {},
): Promise<WeeklyOutcome> {
  const week = previousWeek(options.today ?? todayIso());
  if (options.manual) assertCan(options.manual, "settings.manage");
  const settings = await getSettings(prisma, restaurantId);
  if (settings.weeklyRecipients.length === 0) {
    if (options.manual) throw new ServiceError("Cadastre ao menos um e-mail em \"Resumo semanal: quem recebe\" e salve antes de enviar.");
    return { sent: false, reason: "off", week };
  }

  if (!options.manual) {
    const already = await prisma.auditLog.findFirst({
      where: { restaurantId, action: "report.weekly.sent", newValue: { path: ["week"], equals: week.from } },
    });
    if (already) return { sent: false, reason: "already", week };
  }

  const actor = options.manual ?? systemActor(restaurantId);
  const prevWeek = { from: addDays(week.from, -7), to: addDays(week.to, -7) };
  const [restaurant, current, previous, open] = await Promise.all([
    prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId }, select: { name: true } }),
    buildPeriodReport(actor, week),
    buildPeriodReport(actor, prevWeek),
    prisma.cashSession.findMany({
      where: { restaurantId, status: { in: ["OPEN", "REOPENED"] }, businessDate: { gte: toDbDate(week.from), lte: toDbDate(week.to) } },
      include: { shift: { select: { name: true } }, register: { select: { name: true } } },
      orderBy: { businessDate: "asc" },
    }),
  ]);
  const { subject, text, html } = buildWeeklyContent({
    restaurantName: restaurant.name,
    week,
    current,
    previousRevenueCents: previous.totals.revenueCents,
    notClosed: open.map((s) => ({
      date: fromDbDate(s.businessDate),
      shiftName: s.shift.name,
      registerName: s.register.name,
      status: s.status === "OPEN" ? "ainda aberto" : "reaberto, sem fechar de novo",
    })),
    appUrl: process.env.APP_URL || "http://localhost:3000",
  });

  const logData = (action: string, value: Record<string, unknown>) => ({
    restaurantId,
    userId: options.manual?.userId ?? null,
    userName: options.manual?.name ?? "Sistema (resumo semanal)",
    action,
    entity: "restaurant",
    entityId: restaurantId,
    newValue: value as Prisma.InputJsonValue,
  });
  try {
    await sendMail({ from: defaultFrom(settings.emailFrom), to: settings.weeklyRecipients, subject, text, html, attachments: [] });
  } catch (err) {
    const error = errorMessage(err).slice(0, 500);
    if (options.manual) await audit(prisma, options.manual, { action: "report.weekly.failed", entity: "restaurant", entityId: restaurantId, newValue: { week: week.from, to: settings.weeklyRecipients, error } });
    else await prisma.auditLog.create({ data: logData("report.weekly.failed", { week: week.from, to: settings.weeklyRecipients, error }) });
    return { sent: false, reason: "failed", week, error };
  }
  const value = { week: week.from, to: settings.weeklyRecipients, subject, manual: Boolean(options.manual) };
  if (options.manual) await audit(prisma, options.manual, { action: "report.weekly.manual", entity: "restaurant", entityId: restaurantId, newValue: value });
  else await prisma.auditLog.create({ data: logData("report.weekly.sent", value) });
  return { sent: true, to: settings.weeklyRecipients, week };
}

/** Agendamento: todos os restaurantes com o resumo ligado. */
export async function runWeeklySummaries(today?: string) {
  const list = await prisma.setting.findMany({ where: { NOT: { weeklyRecipients: { isEmpty: true } } }, select: { restaurantId: true } });
  const results: { restaurantId: string; outcome: WeeklyOutcome }[] = [];
  for (const s of list) {
    try {
      results.push({ restaurantId: s.restaurantId, outcome: await sendWeeklySummary(s.restaurantId, { today }) });
    } catch (err) {
      results.push({ restaurantId: s.restaurantId, outcome: { sent: false, reason: "failed", week: previousWeek(today ?? todayIso()), error: errorMessage(err).slice(0, 300) } });
    }
  }
  return results;
}
