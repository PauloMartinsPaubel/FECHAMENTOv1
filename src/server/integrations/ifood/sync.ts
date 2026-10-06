import type { Prisma } from "@/generated/prisma/client";
import { toDbDate } from "@/lib/dates";
import { prisma } from "../../db";
import { assignShift, laterStatus, NormalizedOrder, OrderStatus } from "../shared";
import { IfoodClient } from "./client";
import { IfoodEvent, mapIfoodEvent, mapIfoodOrder } from "./mapper";

export interface SyncResult {
  /** rota de eventos que respondeu (ver client.ts) */
  eventsRoute: string;
  events: number;
  newEvents: number;
  ordersSaved: number;
  cancelled: number;
  acknowledged: number;
  failedOrders: { orderId: string; error: string }[];
  warnings: string[];
}

/**
 * Uma rodada de sincronização. Pode rodar quantas vezes quiser: é idempotente.
 *
 * 1. Busca os eventos pendentes da loja.
 * 2. Grava cada evento novo (o id do evento é único: repetido é ignorado).
 * 3. Para cada pedido citado, busca o detalhe, lê e grava (ou atualiza) o pedido.
 * 4. Só então confirma os eventos ao iFood. Pedido que falhou não tem os eventos confirmados,
 *    então volta na próxima rodada.
 */
export async function syncIfoodOnce(restaurantId: string, client: IfoodClient): Promise<SyncResult> {
  const integration = await prisma.platformIntegration.findUnique({
    where: { restaurantId_provider: { restaurantId, provider: "IFOOD" } },
  });
  if (!integration?.enabled || !integration.merchantId) {
    throw new Error("Integração com o iFood desligada ou sem o código da loja (merchantId).");
  }
  const merchantId = integration.merchantId;
  const shifts = await prisma.shift.findMany({ where: { restaurantId, active: true } });

  const rawEvents = await client.pollEvents([merchantId]);
  const events: IfoodEvent[] = [];
  const warnings: string[] = [];
  for (const raw of rawEvents) {
    const e = mapIfoodEvent(raw);
    if (e) events.push(e);
    else warnings.push("Evento do iFood ignorado por estar sem id ou código.");
  }
  // eventos de outra loja não são deste restaurante: não gravamos, mas também não deixamos travar a fila
  const mine = events.filter((e) => !e.merchantId || e.merchantId === merchantId);

  let newEvents = 0;
  for (const e of mine) {
    const created = await prisma.platformEvent.createMany({
      data: [
        {
          provider: "IFOOD",
          externalId: e.id,
          orderExternalId: e.orderId,
          code: e.code,
          occurredAt: e.createdAt,
          raw: e.raw as Prisma.InputJsonValue,
        },
      ],
      skipDuplicates: true,
    });
    newEvents += created.count;
  }

  // status mais avançado visto nesta rodada, por pedido
  const statusByOrder = new Map<string, OrderStatus>();
  const lastEventAt = new Map<string, Date>();
  for (const e of mine) {
    if (!e.orderId) continue;
    statusByOrder.set(e.orderId, laterStatus(statusByOrder.get(e.orderId), e.status));
    if (e.createdAt && (!lastEventAt.get(e.orderId) || e.createdAt > lastEventAt.get(e.orderId)!)) lastEventAt.set(e.orderId, e.createdAt);
  }

  const failedOrders: SyncResult["failedOrders"] = [];
  let ordersSaved = 0;
  let cancelled = 0;
  for (const [orderId, status] of statusByOrder) {
    try {
      const existing = await prisma.platformOrder.findUnique({ where: { provider_externalId: { provider: "IFOOD", externalId: orderId } } });
      let normalized: NormalizedOrder | null = null;
      // pedido novo, ou ainda sem detalhe útil: busca o detalhe. Só mudança de status: não precisa.
      if (!existing) {
        normalized = mapIfoodOrder(await client.getOrder(orderId));
        warnings.push(...normalized.warnings.map((w) => `Pedido ${normalized!.displayId ?? orderId}: ${w}`));
      }
      const finalStatus = laterStatus(laterStatus(existing?.status as OrderStatus | undefined, status), normalized?.reportedStatus);
      const isCancel = finalStatus === "CANCELLED" && existing?.status !== "CANCELLED";
      if (isCancel) cancelled++;

      if (!existing && normalized) {
        const { businessDate } = assignShift(normalized.placedAt, shifts);
        await prisma.platformOrder.create({
          data: {
            restaurantId,
            provider: "IFOOD",
            externalId: normalized.externalId,
            displayId: normalized.displayId,
            merchantId: normalized.merchantId ?? merchantId,
            status: finalStatus,
            placedAt: normalized.placedAt,
            businessDate: toDbDate(businessDate),
            orderType: normalized.orderType,
            subtotalCents: normalized.subtotalCents,
            deliveryFeeCents: normalized.deliveryFeeCents,
            benefitsCents: normalized.benefitsCents,
            totalCents: normalized.totalCents,
            onlineCents: normalized.onlineCents,
            offlineCents: normalized.offlineCents,
            payments: normalized.payments as unknown as Prisma.InputJsonValue,
            raw: normalized as unknown as Prisma.InputJsonValue,
            cancelledAt: finalStatus === "CANCELLED" ? (lastEventAt.get(orderId) ?? new Date()) : null,
            lastEventAt: lastEventAt.get(orderId) ?? null,
          },
        });
      } else if (existing && finalStatus !== existing.status) {
        await prisma.platformOrder.update({
          where: { id: existing.id },
          data: {
            status: finalStatus,
            cancelledAt: isCancel ? (lastEventAt.get(orderId) ?? new Date()) : existing.cancelledAt,
            lastEventAt: lastEventAt.get(orderId) ?? existing.lastEventAt,
          },
        });
      }
      ordersSaved++;
    } catch (err) {
      failedOrders.push({ orderId, error: (err as Error).message });
    }
  }

  // confirma tudo o que foi gravado; eventos de pedidos que falharam ficam para a próxima rodada
  const failed = new Set(failedOrders.map((f) => f.orderId));
  const toAck = events.filter((e) => !e.orderId || !failed.has(e.orderId)).map((e) => e.id);
  await client.acknowledge(toAck);

  return { eventsRoute: client.eventsRoute, events: events.length, newEvents, ordersSaved, cancelled, acknowledged: toAck.length, failedOrders, warnings };
}
