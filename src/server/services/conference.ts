import { formatBRL, MAX_CENTS } from "@/lib/finance";
import { Actor, assertCan } from "../actor";
import { audit, recordAdjustment } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { loadSessionBundle } from "../loaders";
import { assertEditable, lockSession, requireReason } from "./sessions";

/**
 * Grava os valores conferidos pelo operador (contado, máquinas, extratos, plataformas).
 * `values[chave] = centavos` define; `null` limpa. Só aceita chaves que são linhas reais da conferência.
 */
export async function saveConference(
  actor: Actor,
  sessionId: string,
  values: Record<string, number | null>,
  reason?: string | null,
) {
  assertCan(actor, "conference.write");
  return prisma.$transaction(async (tx) => {
    const session = await lockSession(tx, actor, sessionId);
    const mode = assertEditable(actor, session);
    const why = mode === "correction" ? requireReason(reason, "o motivo da correção") : null;

    const bundle = await loadSessionBundle(tx, actor.restaurantId, sessionId);
    const byKey = new Map(bundle.evaluation.lines.map((l) => [l.key, l]));
    const previous = new Map(bundle.conferences.map((c) => [c.lineKey, c]));

    const changes: { label: string; old: number | null; next: number | null }[] = [];
    for (const [key, value] of Object.entries(values)) {
      const line = byKey.get(key);
      if (!line) throw new ServiceError(`Linha de conferência desconhecida: ${key}`);
      if (value !== null && (!Number.isInteger(value) || value < 0 || value > MAX_CENTS)) {
        throw new ServiceError(`Valor inválido em ${line.fullLabel}.`);
      }
      const before = previous.get(key)?.checkedCents ?? null;
      await tx.closingConference.upsert({
        where: { sessionId_lineKey: { sessionId, lineKey: key } },
        create: {
          sessionId,
          lineKey: key,
          groupKind: line.group,
          paymentMethodId: line.paymentMethodId,
          ticketBrandId: line.ticketBrandId,
          channelId: line.channelId,
          label: line.fullLabel,
          checkedCents: value,
          updatedById: actor.userId,
        },
        update: { checkedCents: value, label: line.fullLabel, updatedById: actor.userId },
      });
      if (before !== value) changes.push({ label: line.fullLabel, old: before, next: value });
    }

    if (changes.length > 0) {
      await audit(tx, actor, {
        action: "conference.save",
        entity: "cash_session",
        entityId: sessionId,
        sessionId,
        oldValue: Object.fromEntries(changes.map((c) => [c.label, c.old === null ? null : formatBRL(c.old)])),
        newValue: Object.fromEntries(changes.map((c) => [c.label, c.next === null ? null : formatBRL(c.next)])),
        reason: why,
      });
      if (why) {
        for (const c of changes) {
          await recordAdjustment(tx, actor, {
            sessionId,
            entity: "closing_conference",
            entityId: sessionId,
            field: `Conferência: ${c.label}`,
            oldValue: c.old === null ? null : formatBRL(c.old),
            newValue: c.next === null ? null : formatBRL(c.next),
            reason: why,
          });
        }
      }
    }
    return { changed: changes.length };
  });
}
