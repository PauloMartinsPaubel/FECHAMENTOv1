import type { Db } from "./db";
import { ServiceError } from "./errors";
import type { Catalog, CancellationRow, MovementRow, PaymentKind } from "@/lib/finance";
import { evaluateSession, SessionEvaluation } from "@/lib/finance";

export async function loadCatalogRows(db: Db, restaurantId: string) {
  const [channels, methods, brands, registers, shifts] = await Promise.all([
    db.salesChannel.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.paymentMethod.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.ticketBrand.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.cashRegister.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }] }),
    db.shift.findMany({ where: { restaurantId }, orderBy: [{ sortOrder: "asc" }] }),
  ]);
  return { channels, methods, brands, registers, shifts };
}
export type CatalogRows = Awaited<ReturnType<typeof loadCatalogRows>>;

/** Catálogo no formato do motor financeiro. */
export function toFinanceCatalog(rows: CatalogRows): Catalog {
  return {
    channels: rows.channels.map((c) => ({ id: c.id, name: c.name, isPlatform: c.isPlatform, active: c.active, sortOrder: c.sortOrder })),
    methods: rows.methods.map((m) => ({ id: m.id, name: m.name, kind: m.kind as PaymentKind, active: m.active, sortOrder: m.sortOrder })),
    brands: rows.brands.map((b) => ({ id: b.id, name: b.name, active: b.active, sortOrder: b.sortOrder })),
  };
}

export async function getSettings(db: Db, restaurantId: string) {
  const s = await db.setting.findUnique({ where: { restaurantId } });
  return (
    s ?? {
      id: "",
      restaurantId,
      defaultOpeningFloatCents: 10000,
      toleranceCents: 0,
      defaultFloatMode: "NEW_OPENING" as const,
      closingRecipients: [] as string[],
      emailFrom: null,
      alertRecipients: [] as string[],
      alertThresholdCents: null as number | null,
      weeklyRecipients: [] as string[],
      updatedAt: new Date(),
    }
  );
}

/** Sessão com tudo que a tela e o motor precisam, já avaliada. */
export async function loadSessionBundle(db: Db, restaurantId: string, sessionId: string) {
  const session = await db.cashSession.findFirst({
    where: { id: sessionId, restaurantId },
    include: {
      register: true,
      shift: true,
      responsible: { select: { id: true, name: true } },
      closedBy: { select: { id: true, name: true } },
      transferredFrom: { include: { shift: true, register: true } },
      closing: true,
    },
  });
  if (!session) throw new ServiceError("Caixa não encontrado.", "NOT_FOUND");

  const [movements, cancellations, conferences, catalogRows, settings, restaurant] = await Promise.all([
    db.cashMovement.findMany({
      where: { sessionId },
      include: {
        paymentMethod: { select: { kind: true, name: true } },
        channel: { select: { name: true } },
        ticketBrand: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }],
    }),
    db.cancellation.findMany({
      where: { sessionId },
      include: {
        channel: { select: { name: true } },
        paymentMethod: { select: { kind: true, name: true } },
        createdBy: { select: { name: true } },
      },
      orderBy: { occurredAt: "asc" },
    }),
    db.closingConference.findMany({ where: { sessionId } }),
    loadCatalogRows(db, restaurantId),
    getSettings(db, restaurantId),
    db.restaurant.findUniqueOrThrow({ where: { id: restaurantId } }),
  ]);

  const movementRows: MovementRow[] = movements.map((m) => ({
    id: m.id,
    type: m.type,
    status: m.status,
    amountCents: m.amountCents,
    revenueEffect: m.revenueEffect as MovementRow["revenueEffect"],
    cashEffect: m.cashEffect as MovementRow["cashEffect"],
    channelId: m.channelId,
    paymentMethodId: m.paymentMethodId,
    paymentKind: (m.paymentMethod?.kind as PaymentKind | undefined) ?? null,
    ticketBrandId: m.ticketBrandId,
    orderNumber: m.orderNumber,
    description: m.description,
  }));
  const cancellationRows: CancellationRow[] = cancellations.map((c) => ({
    id: c.id,
    movementId: c.movementId,
    orderNumber: c.orderNumber,
    channelId: c.channelId,
    paymentMethodId: c.paymentMethodId,
    paymentKind: (c.paymentMethod?.kind as PaymentKind | undefined) ?? null,
    amountCents: c.amountCents,
  }));

  const checked: Record<string, number | null> = {};
  for (const c of conferences) checked[c.lineKey] = c.checkedCents;

  const catalog = toFinanceCatalog(catalogRows);
  const evaluation: SessionEvaluation = evaluateSession(
    { openingFloatCents: session.openingFloatCents, movements: movementRows, cancellations: cancellationRows },
    catalog,
    checked,
    settings.toleranceCents,
  );

  return {
    session,
    movements,
    cancellations,
    conferences,
    catalogRows,
    catalog,
    settings,
    restaurant,
    evaluation,
  };
}
export type SessionBundle = Awaited<ReturnType<typeof loadSessionBundle>>;
