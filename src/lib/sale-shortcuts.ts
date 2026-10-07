/**
 * Atalhos do lançamento rápido: as combinações de canal, forma de pagamento (e bandeira, no ticket)
 * mais usadas pelo restaurante nos últimos dias. Um toque escolhe a combinação e leva direto ao valor.
 */
export interface ShortcutCatalog {
  channels: { id: string; name: string }[];
  methods: { id: string; name: string; kind: string }[];
  brands: { id: string; name: string }[];
}

export interface SaleShortcut {
  channelId: string;
  paymentMethodId: string;
  ticketBrandId: string | null;
  label: string;
  /** vendas com essa combinação no período (0 = atalho padrão, sem histórico) */
  uses: number;
}

export interface ShortcutUsage {
  channelId: string | null;
  paymentMethodId: string | null;
  ticketBrandId: string | null;
  count: number;
}

export const SHORTCUT_LIMIT = 6;
export const SHORTCUT_DAYS = 30;

const DEFAULT_KINDS = ["CASH", "PIX", "CREDIT", "DEBIT"];

export function rankSaleShortcuts(usage: ShortcutUsage[], catalog: ShortcutCatalog, limit = SHORTCUT_LIMIT): SaleShortcut[] {
  const channels = new Map(catalog.channels.map((c) => [c.id, c]));
  const methods = new Map(catalog.methods.map((m) => [m.id, m]));
  const brands = new Map(catalog.brands.map((b) => [b.id, b]));

  const ranked: SaleShortcut[] = [];
  for (const u of usage) {
    const channel = u.channelId ? channels.get(u.channelId) : undefined;
    const method = u.paymentMethodId ? methods.get(u.paymentMethodId) : undefined;
    // canal ou forma desativados (ou apagados do cadastro) não viram atalho
    if (!channel || !method || u.count <= 0) continue;
    const isTicket = method.kind === "TICKET";
    const brand = isTicket && u.ticketBrandId ? brands.get(u.ticketBrandId) : undefined;
    if (isTicket && !brand) continue;
    ranked.push({
      channelId: channel.id,
      paymentMethodId: method.id,
      ticketBrandId: brand?.id ?? null,
      label: `${channel.name} · ${brand ? brand.name : method.name}`,
      uses: u.count,
    });
  }
  ranked.sort((a, b) => b.uses - a.uses || a.label.localeCompare(b.label, "pt-BR"));
  const out = ranked.slice(0, limit);

  // pouco histórico (restaurante novo): completa com o primeiro canal e as formas mais comuns
  const first = catalog.channels[0];
  if (first) {
    for (const kind of DEFAULT_KINDS) {
      if (out.length >= limit) break;
      const m = catalog.methods.find((x) => x.kind === kind);
      if (!m || out.some((s) => s.channelId === first.id && s.paymentMethodId === m.id)) continue;
      out.push({ channelId: first.id, paymentMethodId: m.id, ticketBrandId: null, label: `${first.name} · ${m.name}`, uses: 0 });
    }
  }
  return out;
}
