import { rankSaleShortcuts, SHORTCUT_DAYS, type SaleShortcut, type ShortcutCatalog } from "@/lib/sale-shortcuts";
import { prisma } from "../db";

/** Atalhos de venda do restaurante: combinações mais lançadas nos últimos 30 dias (todos os caixas). */
export async function saleShortcuts(restaurantId: string, catalog: ShortcutCatalog, now: Date = new Date()): Promise<SaleShortcut[]> {
  const since = new Date(now.getTime() - SHORTCUT_DAYS * 24 * 60 * 60 * 1000);
  const groups = await prisma.cashMovement.groupBy({
    by: ["channelId", "paymentMethodId", "ticketBrandId"],
    where: { restaurantId, type: "VENDA", status: "ACTIVE", occurredAt: { gte: since } },
    _count: { _all: true },
  });
  return rankSaleShortcuts(
    groups.map((g) => ({ channelId: g.channelId, paymentMethodId: g.paymentMethodId, ticketBrandId: g.ticketBrandId, count: g._count._all })),
    catalog,
  );
}
