import {
  Catalog,
  classifyMovement,
  MovementRow,
  MovementType,
  PaymentKind,
} from "@/lib/finance";

export const catalog: Catalog = {
  channels: [
    { id: "ch-balcao", name: "Balcão", isPlatform: false, sortOrder: 1 },
    { id: "ch-ifood", name: "iFood", isPlatform: true, sortOrder: 2 },
    { id: "ch-99", name: "99Food", isPlatform: true, sortOrder: 3 },
    { id: "ch-tel", name: "Telefone/Tablet", isPlatform: false, sortOrder: 4 },
    { id: "ch-ecl", name: "Eclética", isPlatform: false, sortOrder: 5 },
  ],
  methods: [
    { id: "pm-cash", name: "Dinheiro", kind: "CASH", sortOrder: 1 },
    { id: "pm-credit", name: "Cartão de crédito", kind: "CREDIT", sortOrder: 2 },
    { id: "pm-debit", name: "Cartão de débito", kind: "DEBIT", sortOrder: 3 },
    { id: "pm-pix", name: "PIX", kind: "PIX", sortOrder: 4 },
    { id: "pm-ticket", name: "Tickets / Vales", kind: "TICKET", sortOrder: 5 },
    { id: "pm-online", name: "Pagamento online", kind: "ONLINE", sortOrder: 6 },
    { id: "pm-other", name: "Outros", kind: "OTHER", sortOrder: 7 },
  ],
  brands: [
    { id: "tb-alelo", name: "Alelo", sortOrder: 1 },
    { id: "tb-vr", name: "VR", sortOrder: 2 },
    { id: "tb-ticket", name: "Ticket Restaurante", sortOrder: 3 },
    { id: "tb-pluxee", name: "Pluxee", sortOrder: 4 },
  ],
};

const methodByKind: Record<PaymentKind, string> = {
  CASH: "pm-cash",
  CREDIT: "pm-credit",
  DEBIT: "pm-debit",
  PIX: "pm-pix",
  TICKET: "pm-ticket",
  ONLINE: "pm-online",
  OTHER: "pm-other",
};

let seq = 0;

export interface MakeOpts {
  channelId?: string;
  ticketBrandId?: string | null;
  status?: MovementRow["status"];
  orderNumber?: string;
  description?: string;
  adjustment?: { direction: 1 | -1; affectsRevenue: boolean; affectsCash: boolean };
}

/** Monta uma movimentação exatamente como o serviço grava: efeitos vêm de classifyMovement. */
export function mov(type: MovementType, kind: PaymentKind | null, cents: number, opts: MakeOpts = {}): MovementRow {
  const channelId =
    opts.channelId ?? (type === "VENDA" || type === "ESTORNO" || opts.adjustment?.affectsRevenue ? "ch-balcao" : null);
  const ticketBrandId = opts.ticketBrandId !== undefined ? opts.ticketBrandId : kind === "TICKET" ? "tb-alelo" : null;
  const fx = classifyMovement({ type, paymentKind: kind, channelId, ticketBrandId, adjustment: opts.adjustment });
  return {
    id: `m${++seq}`,
    type,
    status: opts.status ?? "ACTIVE",
    amountCents: cents,
    revenueEffect: fx.revenueEffect,
    cashEffect: fx.cashEffect,
    channelId,
    paymentMethodId: kind ? methodByKind[kind] : null,
    paymentKind: kind,
    ticketBrandId,
    orderNumber: opts.orderNumber ?? null,
    description: opts.description ?? null,
  };
}

export const R = (reais: number) => Math.round(reais * 100);
