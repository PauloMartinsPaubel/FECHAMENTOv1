import { cashCountTotal, describeCashCount, KIND_LABEL, PAYMENT_KINDS, parseStoredCashCount } from "@/lib/finance";
import { fromDbDate } from "@/lib/dates";
import type { ShiftReportData } from "@/lib/reports/types";
import type { SessionBundle } from "../loaders";

export interface ShiftReportOverrides {
  status?: ShiftReportData["session"]["status"];
  closedAt?: Date | null;
  closedByName?: string | null;
  revision?: number;
  justification?: string | null;
  notes?: string | null;
}

/**
 * Monta a foto completa do turno a partir do que está no banco.
 * É a MESMA função para a prévia (caixa aberto) e para o fechamento (que grava o resultado).
 */
export function buildShiftReportData(bundle: SessionBundle, overrides: ShiftReportOverrides = {}): ShiftReportData {
  const { session, evaluation: ev, catalogRows: cat } = bundle;
  const s = ev.summary;
  const channelName = new Map(cat.channels.map((c) => [c.id, c.name]));
  const methodName = new Map(cat.methods.map((m) => [m.id, m.name]));
  const brandName = new Map(cat.brands.map((b) => [b.id, b.name]));

  const cards = ev.lines.filter((l) => l.group === "CREDIT" || l.group === "DEBIT");
  const cardsChecked = cards.reduce((a, l) => a + (l.checkedCents ?? 0), 0);

  const byChannel = new Map<string, ShiftReportData["matrix"][number]>();
  for (const cell of s.matrix) {
    const name = channelName.get(cell.channelId) ?? "Canal removido";
    const entry = byChannel.get(cell.channelId) ?? { channelName: name, totalCents: 0, cells: [] };
    entry.cells.push({
      methodName: methodName.get(cell.paymentMethodId) ?? "Forma removida",
      kind: cell.paymentKind,
      brandName: cell.ticketBrandId ? (brandName.get(cell.ticketBrandId) ?? "Bandeira removida") : null,
      netCents: cell.netCents,
    });
    entry.totalCents += cell.netCents;
    byChannel.set(cell.channelId, entry);
  }
  const matrix = [...byChannel.values()].sort((a, b) => a.channelName.localeCompare(b.channelName, "pt-BR"));

  const closing = session.closing;
  const transferred = session.transferredFrom;
  const stored = parseStoredCashCount(bundle.conferences.find((c) => c.lineKey === "cash")?.breakdown);
  const cashCount: ShiftReportData["cashCount"] = stored ? { lines: describeCashCount(stored), totalCents: cashCountTotal(stored) } : null;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    restaurantName: bundle.restaurant.name,
    session: {
      id: session.id,
      businessDate: fromDbDate(session.businessDate),
      shiftName: session.shift.name,
      shiftCode: session.shift.code,
      registerName: session.register.name,
      responsibleName: session.responsible.name,
      openedAt: session.openedAt.toISOString(),
      closedAt: (overrides.closedAt !== undefined ? overrides.closedAt : session.closedAt)?.toISOString() ?? null,
      closedByName: overrides.closedByName !== undefined ? overrides.closedByName : (session.closedBy?.name ?? null),
      status: overrides.status ?? session.status,
      floatMode: session.floatMode,
      transferredFromLabel: transferred
        ? `${transferred.shift.name} (${transferred.register.name}, ${fromDbDate(transferred.businessDate)})`
        : null,
      revision: overrides.revision ?? closing?.revision ?? 0,
      reopenCount: session.reopenCount,
    },
    floatCents: s.floatCents,
    cashCount,
    salesByKind: PAYMENT_KINDS.map((kind) => ({
      kind,
      label: KIND_LABEL[kind],
      grossCents: s.byKind[kind].grossCents,
      refundsCents: s.byKind[kind].refundsCents,
      adjustmentCents: s.byKind[kind].adjustmentCents,
      netCents: s.byKind[kind].netCents,
    })),
    totals: {
      grossSalesCents: s.grossSalesCents,
      refundsCents: s.refundsCents,
      revenueAdjustmentCents: s.revenueAdjustmentCents,
      revenueCents: s.revenueCents,
      controlledCents: s.controlledCents,
      cardsCents: s.cards.totalCents,
      suppliesCents: s.suppliesCents,
      withdrawalsCents: s.withdrawalsCents,
      expensesTotalCents: s.expensesTotalCents,
      cancellationsCents: s.cancellationsCents,
      cancellationsCount: s.cancellationsCount,
    },
    cash: s.cash,
    conference: ev.lines.map((l) => ({
      key: l.key,
      group: l.group,
      label: l.label,
      fullLabel: l.fullLabel,
      systemCents: l.systemCents,
      expectedCents: l.expectedCents,
      checkedCents: l.checkedCents,
      differenceCents: l.differenceCents,
    })),
    cardsConference: {
      systemCents: cards.reduce((a, l) => a + l.systemCents, 0),
      checkedCents: cardsChecked,
      differenceCents: cards.reduce((a, l) => a + (l.differenceCents ?? 0), 0),
    },
    divergence: {
      netCents: ev.divergence.netCents,
      absCents: ev.divergence.absCents,
      status: ev.divergence.status,
      toleranceCents: ev.divergence.toleranceCents,
      requiresJustification: ev.divergence.requiresJustification,
      byGroup: ev.divergence.byGroup,
      origins: ev.divergence.origins,
      hints: ev.divergence.hints,
    },
    matrix,
    ticketBrands: s.byTicketBrand
      .map((b) => ({ name: brandName.get(b.ticketBrandId) ?? "Bandeira removida", netCents: b.netCents }))
      .sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    cancellations: bundle.cancellations.map((c) => ({
      orderNumber: c.orderNumber,
      channelName: c.channel.name,
      methodName: c.paymentMethod?.name ?? null,
      amountCents: c.amountCents,
      reason: c.reason,
      employeeName: c.employeeName,
      occurredAt: c.occurredAt.toISOString(),
      linkedToSale: c.movementId !== null,
    })),
    movementLines: bundle.movements
      .filter((m) => m.status === "ACTIVE" && m.type !== "VENDA")
      .map((m) => ({
        type: m.type,
        amountCents: m.amountCents,
        description: m.description,
        methodName: m.paymentMethod?.name ?? null,
        channelName: m.channel?.name ?? null,
        orderNumber: m.orderNumber,
        occurredAt: m.occurredAt.toISOString(),
        cashEffect: m.cashEffect,
        revenueEffect: m.revenueEffect,
      })),
    justification: overrides.justification !== undefined ? overrides.justification : (closing?.justification ?? null),
    notes: overrides.notes !== undefined ? overrides.notes : (closing?.notes ?? null),
    integrityIssues: ev.issues,
  };
}
