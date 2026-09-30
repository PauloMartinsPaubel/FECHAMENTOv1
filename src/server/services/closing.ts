import { Prisma } from "@/generated/prisma/client";
import { formatBRL, headlineOf } from "@/lib/finance";
import type { ShiftReportData } from "@/lib/reports/types";
import { Actor, assertCan } from "../actor";
import { audit, recordAdjustment } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { loadSessionBundle } from "../loaders";
import { buildShiftReportData } from "../reports/shift-data";
import { assertSessionAccess, lockSession, requireReason } from "./sessions";

const CLOSING_FIELD_LABEL: Record<string, string> = {
  revenueCents: "Faturamento",
  floatCents: "Fundo de abertura",
  cashSalesCents: "Vendas em dinheiro",
  creditCents: "Crédito",
  debitCents: "Débito",
  pixCents: "PIX",
  ticketsCents: "Tickets",
  onlineCents: "Online",
  otherCents: "Outros",
  suppliesCents: "Suprimentos",
  withdrawalsCents: "Sangrias",
  expensesCents: "Despesas",
  cancellationsCents: "Cancelamentos",
  cashExpectedCents: "Dinheiro esperado",
  cashCountedCents: "Dinheiro contado",
  cashDiffCents: "Diferença de dinheiro",
  cardsDiffCents: "Diferença de cartões",
  pixDiffCents: "Diferença de PIX",
  ticketsDiffCents: "Diferença de tickets",
  onlineDiffCents: "Diferença online",
  otherDiffCents: "Diferença de outros",
  totalDiffCents: "Divergência total",
  status: "Status do fechamento",
  justification: "Justificativa",
  notes: "Observações",
};

export interface CloseInput {
  /** exigida quando a diferença passa da tolerância */
  justification?: string | null;
  notes?: string | null;
  /** exigido ao fechar de novo um caixa que foi reaberto: o que foi corrigido */
  correctionReason?: string | null;
}

/**
 * FECHAR O CAIXA. Numa única transação: trava a sessão, recalcula tudo do banco,
 * confere as regras, grava o fechamento, a foto do relatório, o detalhe e a auditoria.
 * E-mail é outra etapa: nunca entra aqui, para o fechamento não depender do envio.
 */
export async function closeSession(actor: Actor, sessionId: string, input: CloseInput = {}) {
  return prisma.$transaction(
    async (tx) => {
      const locked = await lockSession(tx, actor, sessionId);
      assertSessionAccess(actor, locked);

      const isReclose = locked.status === "REOPENED";
      if (locked.status === "OPEN") assertCan(actor, "session.close");
      else if (isReclose) assertCan(actor, "closing.correct");
      else throw new ServiceError("Este caixa já está fechado.", "STATE");

      const bundle = await loadSessionBundle(tx, actor.restaurantId, sessionId);
      const ev = bundle.evaluation;

      if (ev.issues.length > 0) {
        throw new ServiceError(`Há inconsistências que impedem o fechamento: ${ev.issues.slice(0, 3).join(" ")}`, "INTEGRITY");
      }
      if (ev.divergence.pendingKeys.length > 0) {
        const labels = ev.lines.filter((l) => ev.divergence.pendingKeys.includes(l.key)).map((l) => l.fullLabel);
        throw new ServiceError(`Falta conferir: ${labels.join(", ")}.`, "VALIDATION");
      }
      const status = ev.divergence.status;
      if (!status) throw new ServiceError("Conferência incompleta.", "VALIDATION");

      const justification = input.justification?.trim() || null;
      if (ev.divergence.requiresJustification && (!justification || justification.length < 5)) {
        throw new ServiceError(
          `A diferença de ${formatBRL(ev.divergence.absCents)} passa da tolerância de ${formatBRL(ev.divergence.toleranceCents)}. Escreva a justificativa da divergência.`,
          "VALIDATION",
        );
      }
      if (justification && justification.length > 1000) throw new ServiceError("A justificativa é longa demais.");
      const notes = input.notes?.trim() || null;
      if (notes && notes.length > 2000) throw new ServiceError("A observação é longa demais.");
      const correctionReason = isReclose ? requireReason(input.correctionReason, "o que foi corrigido") : null;

      const previous = bundle.session.closing;
      const revision = (previous?.revision ?? 0) + 1;
      const newStatus = isReclose ? "CORRECTED" : "CLOSED";
      const now = new Date();

      const snapshot: ShiftReportData = buildShiftReportData(bundle, {
        status: newStatus,
        closedAt: now,
        closedByName: actor.name,
        revision,
        justification,
        notes,
      });

      const s = ev.summary;
      const h = headlineOf(s, ev.divergence);
      const groupDiff = (g: string) => ev.divergence.byGroup.find((x) => x.group === g)?.differenceCents ?? 0;
      const cashLine = ev.lines.find((l) => l.key === "cash");

      const data = {
        status,
        floatCents: s.floatCents,
        revenueCents: s.revenueCents,
        grossSalesCents: s.grossSalesCents,
        refundsCents: s.refundsCents,
        controlledCents: s.controlledCents,
        cashSalesCents: h.cashSalesCents,
        creditCents: h.creditCents,
        debitCents: h.debitCents,
        cardsCents: h.cardsCents,
        pixCents: h.pixCents,
        ticketsCents: h.ticketsCents,
        onlineCents: h.onlineCents,
        otherCents: h.otherCents,
        suppliesCents: s.suppliesCents,
        withdrawalsCents: s.withdrawalsCents,
        expensesCents: s.expensesTotalCents,
        cancellationsCents: s.cancellationsCents,
        cashExpectedCents: s.cash.expectedCents,
        cashCountedCents: cashLine?.checkedCents ?? 0,
        cashDiffCents: groupDiff("CASH"),
        cardsDiffCents: groupDiff("CREDIT") + groupDiff("DEBIT"),
        pixDiffCents: groupDiff("PIX"),
        ticketsDiffCents: groupDiff("TICKET"),
        onlineDiffCents: groupDiff("ONLINE"),
        otherDiffCents: groupDiff("OTHER"),
        totalDiffCents: ev.divergence.netCents,
        absDiffCents: ev.divergence.absCents,
        toleranceCents: ev.divergence.toleranceCents,
        justification,
        notes,
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        closedAt: now,
        closedById: actor.userId,
        revision,
      };

      const closing = previous
        ? await tx.cashClosing.update({ where: { id: previous.id }, data })
        : await tx.cashClosing.create({ data: { ...data, restaurantId: actor.restaurantId, sessionId } });

      // detalhe congelado: matriz canal x forma e totais por tipo
      await tx.closingDetail.deleteMany({ where: { closingId: closing.id } });
      const channelName = new Map(bundle.catalogRows.channels.map((c) => [c.id, c.name]));
      const methodName = new Map(bundle.catalogRows.methods.map((m) => [m.id, m.name]));
      const brandName = new Map(bundle.catalogRows.brands.map((b) => [b.id, b.name]));
      await tx.closingDetail.createMany({
        data: [
          ...s.matrix.map((c) => ({
            closingId: closing.id,
            section: "MATRIX",
            channelId: c.channelId,
            paymentMethodId: c.paymentMethodId,
            ticketBrandId: c.ticketBrandId,
            label: [channelName.get(c.channelId), methodName.get(c.paymentMethodId), c.ticketBrandId ? brandName.get(c.ticketBrandId) : null]
              .filter(Boolean)
              .join(" / "),
            amountCents: c.netCents,
          })),
          ...(
            [
              ["Vendas brutas", s.grossSalesCents],
              ["Estornos", s.refundsCents],
              ["Faturamento", s.revenueCents],
              ["Fundo de abertura", s.floatCents],
              ["Valores controlados (faturamento + fundo)", s.controlledCents],
              ["Suprimentos", s.suppliesCents],
              ["Sangrias", s.withdrawalsCents],
              ["Despesas", s.expensesTotalCents],
              ["Cancelamentos", s.cancellationsCents],
              ["Dinheiro esperado", s.cash.expectedCents],
            ] as [string, number][]
          ).map(([label, amountCents]) => ({
            closingId: closing.id,
            section: "MOVEMENT_TOTAL",
            label,
            amountCents,
          })),
        ],
      });

      // conferência congelada: sistema, esperado, conferido e diferença de cada linha
      for (const l of ev.lines) {
        await tx.closingConference.upsert({
          where: { sessionId_lineKey: { sessionId, lineKey: l.key } },
          create: {
            sessionId,
            closingId: closing.id,
            lineKey: l.key,
            groupKind: l.group,
            paymentMethodId: l.paymentMethodId,
            ticketBrandId: l.ticketBrandId,
            channelId: l.channelId,
            label: l.fullLabel,
            systemCents: l.systemCents,
            expectedCents: l.expectedCents,
            checkedCents: l.checkedCents,
            differenceCents: l.differenceCents,
            updatedById: actor.userId,
          },
          update: {
            closingId: closing.id,
            label: l.fullLabel,
            systemCents: l.systemCents,
            expectedCents: l.expectedCents,
            checkedCents: l.checkedCents,
            differenceCents: l.differenceCents,
            updatedById: actor.userId,
          },
        });
      }

      await tx.cashSession.update({
        where: { id: sessionId },
        data: { status: newStatus, closedAt: now, closedById: actor.userId },
      });

      // fechamento corrigido: cada número que mudou fica registrado (antes, depois, por quê)
      if (previous) {
        for (const field of Object.keys(CLOSING_FIELD_LABEL)) {
          const before = (previous as Record<string, unknown>)[field];
          const after = (data as Record<string, unknown>)[field];
          if (before !== after) {
            const isMoney = field.endsWith("Cents");
            await recordAdjustment(tx, actor, {
              sessionId,
              closingId: closing.id,
              entity: "cash_closing",
              entityId: closing.id,
              field: CLOSING_FIELD_LABEL[field],
              oldValue: isMoney && typeof before === "number" ? formatBRL(before) : (before as string | null),
              newValue: isMoney && typeof after === "number" ? formatBRL(after) : (after as string | null),
              reason: correctionReason as string,
            });
          }
        }
      }

      await audit(tx, actor, {
        action: isReclose ? "session.correct" : "session.close",
        entity: "cash_closing",
        entityId: closing.id,
        sessionId,
        oldValue: previous ? { revision: previous.revision, snapshot: previous.snapshot } : undefined,
        newValue: {
          revision,
          status,
          revenueCents: s.revenueCents,
          floatCents: s.floatCents,
          totalDiffCents: ev.divergence.netCents,
          absDiffCents: ev.divergence.absCents,
          justification,
        },
        reason: correctionReason ?? justification,
      });

      return { closingId: closing.id, status, revision, sessionStatus: newStatus };
    },
    { timeout: 30000 },
  );
}

/** Reabre um caixa fechado para correção. Só gerente/admin, com motivo. */
export async function reopenSession(actor: Actor, sessionId: string, reason: string) {
  assertCan(actor, "closing.reopen");
  const why = requireReason(reason);
  if (why.length < 5) throw new ServiceError("Explique o motivo da reabertura (mínimo de 5 letras).");
  return prisma.$transaction(async (tx) => {
    const s = await lockSession(tx, actor, sessionId);
    if (s.status !== "CLOSED" && s.status !== "CORRECTED") {
      throw new ServiceError("Só um caixa fechado pode ser reaberto.", "STATE");
    }
    const closing = await tx.cashClosing.findUnique({ where: { sessionId } });
    const updated = await tx.cashSession.update({
      where: { id: s.id },
      data: { status: "REOPENED", reopenCount: { increment: 1 } },
    });
    await recordAdjustment(tx, actor, {
      sessionId: s.id,
      closingId: closing?.id,
      entity: "cash_session",
      entityId: s.id,
      field: "Situação do caixa",
      oldValue: s.status === "CLOSED" ? "Fechado" : "Corrigido",
      newValue: "Reaberto",
      reason: why,
    });
    await audit(tx, actor, {
      action: "session.reopen",
      entity: "cash_session",
      entityId: s.id,
      sessionId: s.id,
      oldValue: { status: s.status, closingRevision: closing?.revision ?? null },
      newValue: { status: "REOPENED" },
      reason: why,
    });
    return updated;
  });
}
