import { fromDbDate, toDbDate } from "@/lib/dates";
import type { PaymentKind } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { IfoodClient, ifoodConfigFromEnv, IfoodMerchant } from "../integrations/ifood/client";
import { SyncResult, syncIfoodOnce } from "../integrations/ifood/sync";
import { assignShift, NormalizedPayment } from "../integrations/shared";
import { loadSessionBundle } from "../loaders";
import { assertSessionAccess } from "./sessions";

export async function getIfoodIntegration(actor: Actor) {
  const row = await prisma.platformIntegration.findUnique({
    where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "IFOOD" } },
  });
  return { row, credentialsConfigured: ifoodConfigFromEnv() !== null };
}

/** Lojas que as credenciais do servidor enxergam no iFood. Só o administrador, que é quem configura. */
export async function listIfoodMerchants(actor: Actor, options: { client?: IfoodClient } = {}): Promise<IfoodMerchant[]> {
  assertCan(actor, "settings.manage");
  const config = ifoodConfigFromEnv();
  if (!options.client && !config) {
    throw new ServiceError("As credenciais do iFood ainda não foram configuradas no servidor (IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET).", "STATE");
  }
  try {
    return await (options.client ?? new IfoodClient(config!)).listMerchants();
  } catch (err) {
    throw new ServiceError(`Não foi possível listar as lojas no iFood: ${(err as Error).message.slice(0, 300)}`, "STATE");
  }
}

export async function saveIfoodSettings(actor: Actor, input: { merchantId: string; channelId: string; enabled: boolean }) {
  assertCan(actor, "settings.manage");
  const merchantId = input.merchantId.trim();
  if (input.enabled && !merchantId) throw new ServiceError("Informe o código da loja no iFood (merchantId) para ligar a integração.");
  if (merchantId.length > 100) throw new ServiceError("Código da loja longo demais.");
  const channel = await prisma.salesChannel.findFirst({ where: { id: input.channelId, restaurantId: actor.restaurantId } });
  if (!channel) throw new ServiceError("Escolha o canal do caixa que recebe os pedidos do iFood.");

  return prisma.$transaction(async (tx) => {
    const before = await tx.platformIntegration.findUnique({
      where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "IFOOD" } },
    });
    const data = { merchantId: merchantId || null, channelId: channel.id, enabled: input.enabled };
    const saved = await tx.platformIntegration.upsert({
      where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "IFOOD" } },
      update: data,
      create: { ...data, restaurantId: actor.restaurantId, provider: "IFOOD" },
    });
    await audit(tx, actor, {
      action: "integration.ifood.settings",
      entity: "platform_integration",
      entityId: saved.id,
      oldValue: before && { merchantId: before.merchantId, channelId: before.channelId, enabled: before.enabled },
      newValue: { ...data, channel: channel.name },
    });
    return saved;
  });
}

function summarize(r: SyncResult): string {
  const parts = [`${r.events} evento(s), ${r.ordersSaved} pedido(s) atualizado(s)`];
  if (r.cancelled) parts.push(`${r.cancelled} cancelado(s)`);
  if (r.failedOrders.length) parts.push(`${r.failedOrders.length} com falha (tentaremos de novo na próxima busca)`);
  if (r.warnings.length) parts.push(`${r.warnings.length} aviso(s) de leitura`);
  return parts.join(", ") + ".";
}

/** Intervalo mínimo entre duas buscas automáticas (abrir a Conferência ou Integrações). */
export const IFOOD_AUTO_SYNC_MS = 60_000;

/**
 * Busca automática, disparada quando alguém abre a Conferência ou Integrações. Nunca lança erro:
 * se não puder (sem credencial, desligada, sem permissão, buscou há menos de 1 minuto), não faz nada.
 * Reserva a vez gravando lastSyncAt antes de buscar, para duas telas abertas juntas não buscarem em dobro.
 */
export async function autoSyncIfood(actor: Actor, options: { client?: IfoodClient; now?: Date } = {}): Promise<{ synced: boolean; changed: boolean }> {
  const skip = { synced: false, changed: false };
  if (!can(actor.role, "conference.write")) return skip;
  if (!options.client && !ifoodConfigFromEnv()) return skip;
  const now = options.now ?? new Date();
  const claimed = await prisma.platformIntegration.updateMany({
    where: {
      restaurantId: actor.restaurantId,
      provider: "IFOOD",
      enabled: true,
      merchantId: { not: null },
      OR: [{ lastSyncAt: null }, { lastSyncAt: { lt: new Date(now.getTime() - IFOOD_AUTO_SYNC_MS) } }],
    },
    data: { lastSyncAt: now },
  });
  if (claimed.count === 0) return skip;
  try {
    const r = await syncIfoodNow(actor, { client: options.client, quiet: true, now });
    return { synced: true, changed: r.newEvents > 0 || r.ordersSaved > 0 };
  } catch {
    // o erro já ficou registrado em lastSyncInfo e na auditoria
    return { synced: true, changed: true };
  }
}

/** Busca agora os pedidos novos do iFood. Qualquer um que confere o caixa pode disparar. */
export async function syncIfoodNow(actor: Actor, options: { client?: IfoodClient; quiet?: boolean; now?: Date } = {}): Promise<SyncResult> {
  assertCan(actor, "conference.write");
  const config = ifoodConfigFromEnv();
  if (!options.client && !config) {
    throw new ServiceError("As credenciais do iFood ainda não foram configuradas no servidor (IFOOD_CLIENT_ID e IFOOD_CLIENT_SECRET).", "STATE");
  }
  const integration = await prisma.platformIntegration.findUnique({
    where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "IFOOD" } },
  });
  if (!integration?.enabled) throw new ServiceError("A integração com o iFood está desligada. Um administrador liga em Integrações.", "STATE");

  const client = options.client ?? new IfoodClient(config!);
  try {
    const result = await syncIfoodOnce(actor.restaurantId, client);
    const info = summarize(result);
    await prisma.platformIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: options.now ?? new Date(), lastSyncOk: result.failedOrders.length === 0, lastSyncInfo: info },
    });
    // busca automática sem nada novo não enche a auditoria; falha e busca com pedidos ficam registradas
    if (!options.quiet || result.events > 0 || result.failedOrders.length > 0) await audit(prisma, actor, {
      action: "integration.ifood.sync",
      entity: "platform_integration",
      entityId: integration.id,
      newValue: { ...result, warnings: result.warnings.slice(0, 20) },
    });
    return result;
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    await prisma.platformIntegration.update({
      where: { id: integration.id },
      data: { lastSyncAt: options.now ?? new Date(), lastSyncOk: false, lastSyncInfo: message },
    });
    await audit(prisma, actor, { action: "integration.ifood.sync_failed", entity: "platform_integration", entityId: integration.id, newValue: { error: message } });
    throw new ServiceError(`Não foi possível buscar os pedidos do iFood: ${message}`, "STATE");
  }
}

export interface PlatformOrderView {
  id: string;
  displayId: string | null;
  placedAt: string;
  status: string;
  totalCents: number;
  onlineCents: number;
  offlineCents: number;
  payments: NormalizedPayment[];
}

export interface IfoodShiftComparison {
  channelName: string;
  businessDate: string;
  shiftName: string;
  /** outros caixas no mesmo turno: o iFood não separa pedidos por caixa */
  sessionsInShift: number;
  orders: PlatformOrderView[];
  activeCount: number;
  cancelledCount: number;
  cancelledCents: number;
  platformOnlineCents: number;
  platformOfflineByKind: Partial<Record<PaymentKind, number>>;
  platformTotalCents: number;
  systemOnlineCents: number;
  /** sistema - iFood: negativo = faltou lançar no caixa; positivo = lançado a mais */
  onlineDifferenceCents: number;
  lastSyncAt: string | null;
  lastSyncInfo: string | null;
  lastSyncOk: boolean | null;
}

/**
 * Compara, para o turno deste caixa, o que o iFood registrou com o que foi lançado no canal do iFood.
 * Pedido cancelado no iFood não conta. Pagamento na entrega aparece à parte (vai para dinheiro/cartão).
 */
export async function ifoodShiftComparison(actor: Actor, sessionId: string): Promise<IfoodShiftComparison | null> {
  const integration = await prisma.platformIntegration.findUnique({
    where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "IFOOD" } },
  });
  if (!integration?.enabled || !integration.channelId) return null;

  const bundle = await loadSessionBundle(prisma, actor.restaurantId, sessionId);
  assertSessionAccess(actor, bundle.session);
  const session = bundle.session;
  const businessDate = fromDbDate(session.businessDate);

  const [shifts, orders, sessionsInShift] = await Promise.all([
    prisma.shift.findMany({ where: { restaurantId: actor.restaurantId } }),
    prisma.platformOrder.findMany({
      where: { restaurantId: actor.restaurantId, provider: "IFOOD", businessDate: toDbDate(businessDate) },
      orderBy: { placedAt: "asc" },
    }),
    prisma.cashSession.count({ where: { restaurantId: actor.restaurantId, businessDate: session.businessDate, shiftId: session.shiftId } }),
  ]);
  const inShift = orders.filter((o) => assignShift(o.placedAt, shifts).shiftId === session.shiftId);
  const active = inShift.filter((o) => o.status !== "CANCELLED");
  const cancelled = inShift.filter((o) => o.status === "CANCELLED");

  const offline: Partial<Record<PaymentKind, number>> = {};
  for (const o of active) {
    for (const p of (o.payments as unknown as NormalizedPayment[]) ?? []) {
      if (p.type === "OFFLINE") offline[p.cashKind] = (offline[p.cashKind] ?? 0) + p.valueCents;
    }
  }
  const platformOnline = active.reduce((a, o) => a + o.onlineCents, 0);
  const systemOnline = bundle.evaluation.summary.matrix
    .filter((c) => c.channelId === integration.channelId && c.paymentKind === "ONLINE")
    .reduce((a, c) => a + c.netCents, 0);
  const channel = bundle.catalogRows.channels.find((c) => c.id === integration.channelId);

  return {
    channelName: channel?.name ?? "iFood",
    businessDate,
    shiftName: session.shift.name,
    sessionsInShift,
    orders: inShift.map((o) => ({
      id: o.id,
      displayId: o.displayId,
      placedAt: o.placedAt.toISOString(),
      status: o.status,
      totalCents: o.totalCents,
      onlineCents: o.onlineCents,
      offlineCents: o.offlineCents,
      payments: (o.payments as unknown as NormalizedPayment[]) ?? [],
    })),
    activeCount: active.length,
    cancelledCount: cancelled.length,
    cancelledCents: cancelled.reduce((a, o) => a + o.totalCents, 0),
    platformOnlineCents: platformOnline,
    platformOfflineByKind: offline,
    platformTotalCents: active.reduce((a, o) => a + o.totalCents, 0),
    systemOnlineCents: systemOnline,
    onlineDifferenceCents: systemOnline - platformOnline,
    lastSyncAt: integration.lastSyncAt?.toISOString() ?? null,
    lastSyncInfo: integration.lastSyncInfo,
    lastSyncOk: integration.lastSyncOk,
  };
}

export async function listRecentPlatformOrders(actor: Actor, take = 30) {
  assertCan(actor, "reports.view");
  return prisma.platformOrder.findMany({
    where: { restaurantId: actor.restaurantId, provider: "IFOOD" },
    orderBy: { placedAt: "desc" },
    take,
  });
}
