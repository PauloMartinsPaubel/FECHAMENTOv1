import { Prisma } from "@/generated/prisma/client";
import { CashCount, cashCountText, cashCountTotal, formatBRL, MAX_CENTS, normalizeCashCount, sameCashCount } from "@/lib/finance";
import { Actor, assertCan } from "../actor";
import { audit, recordAdjustment } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { loadSessionBundle } from "../loaders";
import { assertEditable, lockSession, requireReason } from "./sessions";

/**
 * Grava os valores conferidos pelo operador (contado, máquinas, extratos, plataformas).
 * `values[chave] = centavos` define; `null` limpa. Só aceita chaves que são linhas reais da conferência.
 *
 * `cashCount`: contagem do dinheiro por cédula e moeda. `undefined` não mexe na contagem guardada;
 * `null` apaga (a pessoa voltou a digitar só o total); um objeto grava, e o dinheiro conferido tem de ser
 * exatamente a soma da contagem.
 */
export async function saveConference(
  actor: Actor,
  sessionId: string,
  values: Record<string, number | null>,
  reason?: string | null,
  cashCount?: Record<string, unknown> | null,
) {
  assertCan(actor, "conference.write");
  let count: CashCount | null | undefined = cashCount === undefined || cashCount === null ? cashCount : undefined;
  if (cashCount) {
    try {
      count = normalizeCashCount(cashCount);
    } catch (err) {
      throw new ServiceError((err as Error).message);
    }
    if (!("cash" in values)) throw new ServiceError("A contagem de cédulas e moedas precisa vir junto com o dinheiro conferido.");
    const total = cashCountTotal(count);
    if (values.cash !== total) {
      throw new ServiceError(
        `A contagem de cédulas e moedas soma ${formatBRL(total)}, mas o dinheiro conferido está ${values.cash === null ? "vazio" : formatBRL(values.cash)}.`,
      );
    }
  }
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
      const countData =
        key === "cash" && count !== undefined ? { breakdown: count === null ? Prisma.DbNull : (count as Prisma.InputJsonValue) } : {};
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
          ...countData,
        },
        update: { checkedCents: value, label: line.fullLabel, updatedById: actor.userId, ...countData },
      });
      if (before !== value) changes.push({ label: line.fullLabel, old: before, next: value });
    }

    const prevCount = (previous.get("cash")?.breakdown ?? null) as CashCount | null;
    const countChanged = count !== undefined && !sameCashCount(prevCount, count);
    const COUNT_LABEL = "Contagem de cédulas e moedas";
    const countText = (c: CashCount | null) => (c === null ? null : cashCountText(c));

    if (changes.length > 0 || countChanged) {
      await audit(tx, actor, {
        action: "conference.save",
        entity: "cash_session",
        entityId: sessionId,
        sessionId,
        oldValue: {
          ...Object.fromEntries(changes.map((c) => [c.label, c.old === null ? null : formatBRL(c.old)])),
          ...(countChanged ? { [COUNT_LABEL]: countText(prevCount) } : {}),
        },
        newValue: {
          ...Object.fromEntries(changes.map((c) => [c.label, c.next === null ? null : formatBRL(c.next)])),
          ...(countChanged ? { [COUNT_LABEL]: countText(count ?? null) } : {}),
        },
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
        if (countChanged) {
          await recordAdjustment(tx, actor, {
            sessionId,
            entity: "closing_conference",
            entityId: sessionId,
            field: `Conferência: ${COUNT_LABEL}`,
            oldValue: countText(prevCount),
            newValue: countText(count ?? null),
            reason: why,
          });
        }
      }
    }
    return { changed: changes.length + (countChanged ? 1 : 0) };
  });
}
