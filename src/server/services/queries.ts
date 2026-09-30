import type { Prisma, SessionStatus } from "@/generated/prisma/client";
import { addDays, fromDbDate, isIsoDate, toDbDate, todayIso } from "@/lib/dates";
import {
  consolidateDay,
  DayConsolidation,
  emptyHeadline,
  evaluateSession,
  Headline,
  headlineOf,
  KIND_LABEL,
  PAYMENT_KINDS,
  PaymentKind,
  addHeadlines,
  sumHeadlines,
  SessionEvaluation,
  MovementRow,
  CancellationRow,
} from "@/lib/finance";
import type { DayReportData } from "@/lib/reports/html";
import { statusText } from "@/lib/reports/labels";
import type { CorrectionLine } from "@/lib/reports/types";
import { Actor } from "../actor";
import { Db, prisma } from "../db";
import { ServiceError } from "../errors";
import { CatalogRows, getSettings, loadCatalogRows, toFinanceCatalog } from "../loaders";
import { canAccessSession } from "./sessions";

export interface SessionFilter {
  from: string;
  to: string;
  shiftId?: string;
  registerId?: string;
  responsibleId?: string;
  statuses?: SessionStatus[];
  sessionIds?: string[];
}

export const MAX_RANGE_DAYS = 400;

export function validateRange(from: string, to: string) {
  if (!isIsoDate(from) || !isIsoDate(to)) throw new ServiceError("Período inválido.");
  if (from > to) throw new ServiceError("A data inicial é depois da final.");
  const days = (toDbDate(to).getTime() - toDbDate(from).getTime()) / 86_400_000;
  if (days > MAX_RANGE_DAYS) throw new ServiceError(`Período longo demais (máximo de ${MAX_RANGE_DAYS} dias).`);
}

const movementInclude = {
  paymentMethod: { select: { kind: true, name: true } },
  channel: { select: { name: true } },
  ticketBrand: { select: { name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.CashMovementInclude;

export type MovementWithNames = Prisma.CashMovementGetPayload<{ include: typeof movementInclude }>;

const cancellationInclude = {
  channel: { select: { name: true } },
  paymentMethod: { select: { kind: true, name: true } },
  createdBy: { select: { name: true } },
} satisfies Prisma.CancellationInclude;
export type CancellationWithNames = Prisma.CancellationGetPayload<{ include: typeof cancellationInclude }>;

const sessionInclude = {
  register: true,
  shift: true,
  responsible: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  closing: true,
} satisfies Prisma.CashSessionInclude;

export interface EvaluatedSession {
  session: Prisma.CashSessionGetPayload<{ include: typeof sessionInclude }>;
  movements: MovementWithNames[];
  cancellations: CancellationWithNames[];
  evaluation: SessionEvaluation;
  headline: Headline;
}

/**
 * Carrega várias sessões de uma vez (poucas consultas, sem N+1) e avalia cada uma com o motor.
 * Todos os relatórios de período, o dia consolidado e o CSV partem daqui.
 */
export async function loadEvaluatedSessions(
  db: Db,
  actor: Actor,
  filter: SessionFilter,
): Promise<{ sessions: EvaluatedSession[]; catalogRows: CatalogRows }> {
  validateRange(filter.from, filter.to);
  const where: Prisma.CashSessionWhereInput = {
    restaurantId: actor.restaurantId,
    businessDate: { gte: toDbDate(filter.from), lte: toDbDate(filter.to) },
    ...(filter.shiftId ? { shiftId: filter.shiftId } : {}),
    ...(filter.registerId ? { registerId: filter.registerId } : {}),
    ...(filter.responsibleId ? { responsibleId: filter.responsibleId } : {}),
    ...(filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
    ...(filter.sessionIds ? { id: { in: filter.sessionIds } } : {}),
  };
  const [allSessions, catalogRows, settings] = await Promise.all([
    db.cashSession.findMany({
      where,
      include: sessionInclude,
      orderBy: [{ businessDate: "asc" }, { shift: { sortOrder: "asc" } }, { register: { sortOrder: "asc" } }],
    }),
    loadCatalogRows(db, actor.restaurantId),
    getSettings(db, actor.restaurantId),
  ]);
  const sessions = allSessions.filter((s) => canAccessSession(actor, s));
  const ids = sessions.map((s) => s.id);
  const [movements, cancellations, conferences] = await Promise.all([
    db.cashMovement.findMany({ where: { sessionId: { in: ids } }, include: movementInclude, orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }] }),
    db.cancellation.findMany({ where: { sessionId: { in: ids } }, include: cancellationInclude, orderBy: { occurredAt: "asc" } }),
    db.closingConference.findMany({ where: { sessionId: { in: ids } }, select: { sessionId: true, lineKey: true, checkedCents: true } }),
  ]);

  const catalog = toFinanceCatalog(catalogRows);
  const movBy = groupBy(movements, (m) => m.sessionId);
  const canBy = groupBy(cancellations, (c) => c.sessionId);
  const confBy = groupBy(conferences, (c) => c.sessionId);

  const out: EvaluatedSession[] = sessions.map((session) => {
    const mv = movBy.get(session.id) ?? [];
    const cn = canBy.get(session.id) ?? [];
    const checked: Record<string, number | null> = {};
    for (const c of confBy.get(session.id) ?? []) checked[c.lineKey] = c.checkedCents;
    const evaluation = evaluateSession(
      { openingFloatCents: session.openingFloatCents, movements: mv.map(toMovementRow), cancellations: cn.map(toCancellationRow) },
      catalog,
      checked,
      settings.toleranceCents,
    );
    // divergência só conta quando a conferência está completa
    const div = evaluation.divergence.status === null ? { netCents: 0, absCents: 0 } : evaluation.divergence;
    return { session, movements: mv, cancellations: cn, evaluation, headline: headlineOf(evaluation.summary, div) };
  });
  return { sessions: out, catalogRows };
}

function groupBy<T, K>(list: T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of list) {
    const k = key(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}

export function toMovementRow(m: MovementWithNames): MovementRow {
  return {
    id: m.id,
    type: m.type,
    status: m.status,
    amountCents: m.amountCents,
    revenueEffect: m.revenueEffect as MovementRow["revenueEffect"],
    cashEffect: m.cashEffect as MovementRow["cashEffect"],
    channelId: m.channelId,
    paymentMethodId: m.paymentMethodId,
    paymentKind: (m.paymentMethod?.kind as PaymentKind | undefined) ?? null,
    ticketBrandId: m.ticketBrandId,
    orderNumber: m.orderNumber,
    description: m.description,
  };
}
export function toCancellationRow(c: CancellationWithNames): CancellationRow {
  return {
    id: c.id,
    movementId: c.movementId,
    orderNumber: c.orderNumber,
    channelId: c.channelId,
    paymentMethodId: c.paymentMethodId,
    paymentKind: (c.paymentMethod?.kind as PaymentKind | undefined) ?? null,
    amountCents: c.amountCents,
  };
}

// ---------------------------------------------------------------------------
// Fechamento geral do dia
// ---------------------------------------------------------------------------

export async function buildDayReport(actor: Actor, businessDate: string): Promise<DayReportData> {
  const { sessions } = await loadEvaluatedSessions(prisma, actor, { from: businessDate, to: businessDate });
  const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId } });
  const consolidation: DayConsolidation = consolidateDay(
    sessions.map((s) => ({
      sessionId: s.session.id,
      shiftId: s.session.shiftId,
      shiftName: s.session.shift.name,
      shiftOrder: s.session.shift.sortOrder,
      registerName: s.session.register.name,
      floatMode: s.session.floatMode,
      openingFloatCents: s.session.openingFloatCents,
      headline: s.headline,
      status: s.evaluation.divergence.status,
    })),
  );
  return {
    businessDate,
    restaurantName: restaurant.name,
    generatedAt: new Date().toISOString(),
    openSessions: sessions.filter((s) => s.session.status === "OPEN" || s.session.status === "REOPENED").length,
    sessions: sessions.map((s) => ({
      sessionId: s.session.id,
      shiftName: s.session.shift.name,
      registerName: s.session.register.name,
      responsibleName: s.session.responsible.name,
      status: s.session.status,
      floatCents: s.session.openingFloatCents,
      floatMode: s.session.floatMode,
      headline: s.headline,
      diffStatus: s.evaluation.divergence.status,
      closingStatusText: statusText(s.evaluation.divergence.status, s.evaluation.divergence.netCents, s.evaluation.divergence.absCents),
    })),
    consolidation,
  };
}

// ---------------------------------------------------------------------------
// Relatórios gerenciais
// ---------------------------------------------------------------------------

export interface PeriodFilters extends SessionFilter {
  channelId?: string;
  paymentMethodId?: string;
  /** inclui caixas ainda abertos (faturamento parcial) */
  includeOpen?: boolean;
}

export interface BreakdownRow {
  key: string;
  label: string;
  sessionCount: number;
  headline: Headline;
}

export interface PeriodReport {
  from: string;
  to: string;
  scoped: boolean;
  sessionCount: number;
  openCount: number;
  totals: Headline;
  floatCents: number;
  transferredFloatCents: number;
  controlledCents: number;
  byDay: BreakdownRow[];
  byShift: BreakdownRow[];
  byRegister: BreakdownRow[];
  byEmployee: BreakdownRow[];
  byChannel: { channelId: string; name: string; isPlatform: boolean; netCents: number; byKind: Record<PaymentKind, number> }[];
  byMethod: { key: string; label: string; kind: PaymentKind; grossCents: number; refundsCents: number; netCents: number }[];
  byKind: { kind: PaymentKind; label: string; netCents: number }[];
  divergences: {
    sessionId: string;
    date: string;
    shiftName: string;
    registerName: string;
    responsibleName: string;
    status: string | null;
    netCents: number;
    absCents: number;
    origins: { label: string; differenceCents: number }[];
    justification: string | null;
  }[];
}

export async function buildPeriodReport(actor: Actor, filters: PeriodFilters): Promise<PeriodReport> {
  const statuses: SessionStatus[] | undefined = filters.includeOpen ? undefined : ["CLOSED", "CORRECTED"];
  const { sessions, catalogRows } = await loadEvaluatedSessions(prisma, actor, { ...filters, statuses: filters.statuses ?? statuses });
  const scoped = Boolean(filters.channelId || filters.paymentMethodId);

  const methodName = new Map(catalogRows.methods.map((m) => [m.id, m.name]));
  const brandName = new Map(catalogRows.brands.map((b) => [b.id, b.name]));
  const channelInfo = new Map(catalogRows.channels.map((c) => [c.id, c]));

  // Quando há filtro de canal/forma, o faturamento é recomputado só das células que batem.
  const headlineFor = (s: EvaluatedSession): Headline => {
    if (!scoped) return s.headline;
    const h = emptyHeadline();
    for (const c of s.evaluation.summary.matrix) {
      if (filters.channelId && c.channelId !== filters.channelId) continue;
      if (filters.paymentMethodId && c.paymentMethodId !== filters.paymentMethodId) continue;
      h.revenueCents += c.netCents;
      if (c.paymentKind === "CASH") h.cashSalesCents += c.netCents;
      else if (c.paymentKind === "CREDIT") {
        h.creditCents += c.netCents;
        h.cardsCents += c.netCents;
      } else if (c.paymentKind === "DEBIT") {
        h.debitCents += c.netCents;
        h.cardsCents += c.netCents;
      } else if (c.paymentKind === "PIX") h.pixCents += c.netCents;
      else if (c.paymentKind === "TICKET") h.ticketsCents += c.netCents;
      else if (c.paymentKind === "ONLINE") h.onlineCents += c.netCents;
      else h.otherCents += c.netCents;
    }
    return h;
  };

  const bucket = (keyOf: (s: EvaluatedSession) => { key: string; label: string }): BreakdownRow[] => {
    const map = new Map<string, BreakdownRow>();
    for (const s of sessions) {
      const { key, label } = keyOf(s);
      const row = map.get(key) ?? { key, label, sessionCount: 0, headline: emptyHeadline() };
      row.sessionCount++;
      row.headline = addHeadlines(row.headline, headlineFor(s));
      map.set(key, row);
    }
    return [...map.values()];
  };

  const totals = sumHeadlines(sessions.map(headlineFor));
  const floatCents = scoped ? 0 : sessions.reduce((a, s) => a + (s.session.floatMode === "NEW_OPENING" ? s.session.openingFloatCents : 0), 0);
  const transferredFloatCents = scoped ? 0 : sessions.reduce((a, s) => a + (s.session.floatMode === "TRANSFER" ? s.session.openingFloatCents : 0), 0);

  // canal x forma e forma
  const channelMap = new Map<string, PeriodReport["byChannel"][number]>();
  const methodMap = new Map<string, PeriodReport["byMethod"][number]>();
  const kindMap = new Map<PaymentKind, number>();
  for (const s of sessions) {
    for (const c of s.evaluation.summary.matrix) {
      if (filters.channelId && c.channelId !== filters.channelId) continue;
      if (filters.paymentMethodId && c.paymentMethodId !== filters.paymentMethodId) continue;
      const info = channelInfo.get(c.channelId);
      const ch = channelMap.get(c.channelId) ?? {
        channelId: c.channelId,
        name: info?.name ?? "Canal removido",
        isPlatform: info?.isPlatform ?? false,
        netCents: 0,
        byKind: Object.fromEntries(PAYMENT_KINDS.map((k) => [k, 0])) as Record<PaymentKind, number>,
      };
      ch.netCents += c.netCents;
      ch.byKind[c.paymentKind] += c.netCents;
      channelMap.set(c.channelId, ch);

      const mkey = `${c.paymentMethodId}|${c.ticketBrandId ?? ""}`;
      const label = c.ticketBrandId
        ? `${methodName.get(c.paymentMethodId) ?? "Forma removida"} / ${brandName.get(c.ticketBrandId) ?? "Bandeira removida"}`
        : (methodName.get(c.paymentMethodId) ?? "Forma removida");
      const m = methodMap.get(mkey) ?? { key: mkey, label, kind: c.paymentKind, grossCents: 0, refundsCents: 0, netCents: 0 };
      m.netCents += c.netCents;
      methodMap.set(mkey, m);
      kindMap.set(c.paymentKind, (kindMap.get(c.paymentKind) ?? 0) + c.netCents);
    }
    // bruto e estornos por forma (somente sem filtro de canal, pois vêm do movimento)
    for (const mv of s.movements) {
      if (mv.status !== "ACTIVE" || mv.revenueEffect === 0 || !mv.paymentMethodId || !mv.paymentMethod) continue;
      if (filters.channelId && mv.channelId !== filters.channelId) continue;
      if (filters.paymentMethodId && mv.paymentMethodId !== filters.paymentMethodId) continue;
      const mkey = `${mv.paymentMethodId}|${mv.ticketBrandId ?? ""}`;
      const m = methodMap.get(mkey);
      if (!m) continue;
      if (mv.type === "VENDA") m.grossCents += mv.amountCents;
      else if (mv.type === "ESTORNO") m.refundsCents += mv.amountCents;
    }
  }

  const divergences: PeriodReport["divergences"] = sessions
    .filter((s) => s.evaluation.divergence.status !== null && s.evaluation.divergence.status !== "CORRETO")
    .map((s) => ({
      sessionId: s.session.id,
      date: fromDbDate(s.session.businessDate),
      shiftName: s.session.shift.name,
      registerName: s.session.register.name,
      responsibleName: s.session.responsible.name,
      status: s.evaluation.divergence.status,
      netCents: s.evaluation.divergence.netCents,
      absCents: s.evaluation.divergence.absCents,
      origins: s.evaluation.divergence.origins.map((o) => ({ label: o.label, differenceCents: o.differenceCents })),
      justification: s.session.closing?.justification ?? null,
    }));

  return {
    from: filters.from,
    to: filters.to,
    scoped,
    sessionCount: sessions.length,
    openCount: sessions.filter((s) => s.session.status === "OPEN" || s.session.status === "REOPENED").length,
    totals,
    floatCents,
    transferredFloatCents,
    controlledCents: totals.revenueCents + floatCents,
    byDay: bucket((s) => ({ key: fromDbDate(s.session.businessDate), label: fromDbDate(s.session.businessDate) })).sort((a, b) => a.key.localeCompare(b.key)),
    byShift: bucket((s) => ({ key: s.session.shiftId, label: s.session.shift.name })).sort(
      (a, b) => (catalogRows.shifts.find((x) => x.id === a.key)?.sortOrder ?? 0) - (catalogRows.shifts.find((x) => x.id === b.key)?.sortOrder ?? 0),
    ),
    byRegister: bucket((s) => ({ key: s.session.registerId, label: s.session.register.name })),
    byEmployee: bucket((s) => ({ key: s.session.responsibleId, label: s.session.responsible.name })).sort((a, b) => b.headline.revenueCents - a.headline.revenueCents),
    byChannel: [...channelMap.values()].sort((a, b) => b.netCents - a.netCents),
    byMethod: [...methodMap.values()].sort((a, b) => b.netCents - a.netCents),
    byKind: PAYMENT_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], netCents: kindMap.get(k) ?? 0 })),
    divergences,
  };
}

export function presetRange(preset: string, ref: string = todayIso()): { from: string; to: string } {
  switch (preset) {
    case "ontem":
      return { from: addDays(ref, -1), to: addDays(ref, -1) };
    case "semana": {
      const d = toDbDate(ref);
      const dow = (d.getUTCDay() + 6) % 7;
      return { from: addDays(ref, -dow), to: ref };
    }
    case "mes":
      return { from: `${ref.slice(0, 7)}-01`, to: ref };
    case "7dias":
      return { from: addDays(ref, -6), to: ref };
    case "30dias":
      return { from: addDays(ref, -29), to: ref };
    default:
      return { from: ref, to: ref };
  }
}

// ---------------------------------------------------------------------------
// Histórico, cancelamentos, auditoria, correções
// ---------------------------------------------------------------------------

export interface HistoryFilters {
  from?: string;
  to?: string;
  shiftId?: string;
  registerId?: string;
  status?: "CORRETO" | "FALTA" | "SOBRA" | "MISTO";
  page?: number;
}

export const PAGE_SIZE = 25;

export async function listClosings(actor: Actor, f: HistoryFilters) {
  const where: Prisma.CashClosingWhereInput = {
    restaurantId: actor.restaurantId,
    ...(f.status ? { status: f.status } : {}),
    session: {
      ...(f.from || f.to
        ? { businessDate: { ...(f.from ? { gte: toDbDate(f.from) } : {}), ...(f.to ? { lte: toDbDate(f.to) } : {}) } }
        : {}),
      ...(f.shiftId ? { shiftId: f.shiftId } : {}),
      ...(f.registerId ? { registerId: f.registerId } : {}),
    },
  };
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    prisma.cashClosing.count({ where }),
    prisma.cashClosing.findMany({
      where,
      include: {
        session: { include: { shift: true, register: true, responsible: { select: { name: true } } } },
        closedBy: { select: { name: true } },
        emailLogs: { orderBy: { createdAt: "desc" }, take: 1 },
      },
      orderBy: [{ session: { businessDate: "desc" } }, { session: { shift: { sortOrder: "desc" } } }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
}

export interface CancellationFilters {
  from: string;
  to: string;
  channelId?: string;
  page?: number;
}

export async function listCancellations(actor: Actor, f: CancellationFilters) {
  validateRange(f.from, f.to);
  const where: Prisma.CancellationWhereInput = {
    restaurantId: actor.restaurantId,
    session: { businessDate: { gte: toDbDate(f.from), lte: toDbDate(f.to) } },
    ...(f.channelId ? { channelId: f.channelId } : {}),
  };
  const page = Math.max(1, f.page ?? 1);
  const [total, sum, rows] = await Promise.all([
    prisma.cancellation.count({ where }),
    prisma.cancellation.aggregate({ where, _sum: { amountCents: true } }),
    prisma.cancellation.findMany({
      where,
      include: { channel: true, paymentMethod: true, session: { include: { shift: true, register: true } }, createdBy: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
  ]);
  return { total, totalCents: sum._sum.amountCents ?? 0, page, pages: Math.max(1, Math.ceil(total / PAGE_SIZE)), rows };
}

export interface AuditFilters {
  from?: string;
  to?: string;
  userId?: string;
  action?: string;
  sessionId?: string;
  page?: number;
}

export function auditWhere(actor: Actor, f: AuditFilters): Prisma.AuditLogWhereInput {
  return {
    OR: [{ restaurantId: actor.restaurantId }, { restaurantId: null }],
    ...(f.from || f.to
      ? {
          createdAt: {
            ...(f.from ? { gte: new Date(`${f.from}T00:00:00-03:00`) } : {}),
            ...(f.to ? { lte: new Date(`${f.to}T23:59:59.999-03:00`) } : {}),
          },
        }
      : {}),
    ...(f.userId ? { userId: f.userId } : {}),
    ...(f.action ? { action: { startsWith: f.action } } : {}),
    ...(f.sessionId ? { sessionId: f.sessionId } : {}),
  };
}

export async function listAudit(actor: Actor, f: AuditFilters) {
  const where = auditWhere(actor, f);
  const page = Math.max(1, f.page ?? 1);
  const [total, rows] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * 50, take: 50 }),
  ]);
  return { total, page, pages: Math.max(1, Math.ceil(total / 50)), rows };
}

/** Todas as alterações de um caixa: valor anterior, novo, quem, quando, por quê. */
export async function listCorrections(db: Db, restaurantId: string, sessionId: string): Promise<CorrectionLine[]> {
  const rows = await db.adjustment.findMany({
    where: { sessionId, restaurantId },
    include: { user: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    at: r.createdAt.toISOString(),
    userName: r.user.name,
    entity: r.entity,
    field: r.field,
    oldValue: r.oldValue,
    newValue: r.newValue,
    reason: r.reason,
  }));
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboardData(actor: Actor) {
  const today = todayIso();
  const { sessions } = await loadEvaluatedSessions(prisma, actor, { from: today, to: today });
  const last7 = await prisma.cashClosing.count({
    where: {
      restaurantId: actor.restaurantId,
      status: { not: "CORRETO" },
      session: { businessDate: { gte: toDbDate(addDays(today, -6)), lte: toDbDate(today) } },
    },
  });
  const open = sessions.filter((s) => s.session.status === "OPEN" || s.session.status === "REOPENED");
  const dayTotal = sumHeadlines(sessions.map((s) => s.headline));
  const byShiftMap = new Map<string, { shiftName: string; order: number; headline: Headline; count: number }>();
  for (const s of sessions) {
    const cur = byShiftMap.get(s.session.shiftId) ?? { shiftName: s.session.shift.name, order: s.session.shift.sortOrder, headline: emptyHeadline(), count: 0 };
    cur.headline = addHeadlines(cur.headline, s.headline);
    cur.count++;
    byShiftMap.set(s.session.shiftId, cur);
  }
  return {
    today,
    open,
    all: sessions,
    dayTotal,
    byShift: [...byShiftMap.values()].sort((a, b) => a.order - b.order),
    divergentLast7Days: last7,
    divergencesToday: sessions.filter((s) => s.evaluation.divergence.status && s.evaluation.divergence.status !== "CORRETO").length,
  };
}
