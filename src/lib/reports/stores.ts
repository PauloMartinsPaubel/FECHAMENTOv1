import { KIND_LABEL, PAYMENT_KINDS, type StoreTotals } from "@/lib/finance";
import type { StoreBreakdownLine } from "./types";

export const NO_STORE_LABEL = "Sem marca";

/**
 * Dá nome e ordem ao faturamento por marca: na ordem do cadastro, "Sem marca" (vendas de antes das marcas
 * ou ajustes gerais) por último. Canais e formas só aparecem quando têm valor.
 */
export function describeStores(
  byStore: StoreTotals[],
  stores: { id: string; name: string; sortOrder?: number }[],
  channels: { id: string; name: string }[],
): StoreBreakdownLine[] {
  const order = new Map(stores.map((s, i) => [s.id, i]));
  const storeName = new Map(stores.map((s) => [s.id, s.name]));
  const channelName = new Map(channels.map((c) => [c.id, c.name]));
  return [...byStore]
    .filter((st) => st.storeId !== null || st.netCents !== 0 || st.byChannel.some((c) => c.netCents !== 0))
    .sort((a, b) => (a.storeId === null ? 1 : 0) - (b.storeId === null ? 1 : 0) || (order.get(a.storeId ?? "") ?? 99) - (order.get(b.storeId ?? "") ?? 99))
    .map((st) => ({
      name: st.storeId ? (storeName.get(st.storeId) ?? "Marca removida") : NO_STORE_LABEL,
      revenueCents: st.netCents,
      byKind: PAYMENT_KINDS.filter((k) => st.byKind[k] !== 0).map((k) => ({ kind: k, label: KIND_LABEL[k], netCents: st.byKind[k] })),
      byChannel: st.byChannel
        .filter((c) => c.netCents !== 0)
        .map((c) => ({ channelName: channelName.get(c.channelId) ?? "Canal removido", netCents: c.netCents }))
        .sort((a, b) => b.netCents - a.netCents || a.channelName.localeCompare(b.channelName, "pt-BR")),
    }));
}
