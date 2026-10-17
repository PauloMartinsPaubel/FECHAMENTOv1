import { addDays, fromDbDate, todayIso, toDbDate } from "@/lib/dates";
import type { Actor } from "../actor";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { asaasConfigFromEnv, effectivePrices, updateSubscriptionValue } from "./billing";

/**
 * Painel do dono do sistema: enxerga todos os restaurantes e combina preço com cada um. Só para quem está em
 * PLATFORM_ADMIN_EMAILS, é administrador e tem a verificação em duas etapas ligada. Sem a variável, ninguém.
 */
export function platformAdminEmails(): string[] {
  return (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function isPlatformAdmin(actor: Pick<Actor, "userId" | "email" | "role">): Promise<boolean> {
  if (actor.role !== "ADMIN" || !platformAdminEmails().includes(actor.email.toLowerCase())) return false;
  const u = await prisma.user.findUnique({ where: { id: actor.userId }, select: { active: true, totpEnabledAt: true } });
  return Boolean(u?.active && u.totpEnabledAt);
}

async function assertPlatformAdmin(actor: Actor) {
  if (!(await isPlatformAdmin(actor))) throw new ServiceError("Acesso restrito ao suporte do sistema.", "FORBIDDEN");
}

/** Registro na auditoria do restaurante alterado: o cliente vê que o suporte mexeu e o quê. */
async function platformAudit(actor: Actor, restaurantId: string, action: string, oldValue: unknown, newValue: unknown) {
  await prisma.auditLog.create({
    data: {
      restaurantId,
      userName: `${actor.name} (suporte do sistema)`,
      action,
      entity: "restaurant",
      entityId: restaurantId,
      oldValue: oldValue as object,
      newValue: newValue as object,
      ip: actor.ip ?? undefined,
    },
  });
}

export async function listRestaurantsForPlatform(actor: Actor) {
  await assertPlatformAdmin(actor);
  const rows = await prisma.restaurant.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      createdAt: true,
      billingPlan: true,
      billingCycle: true,
      trialEndsAt: true,
      billingEmail: true,
      customPriceCents: true,
      customAnnualPriceCents: true,
      users: { where: { active: true, role: { code: "ADMIN" } }, select: { name: true, email: true }, orderBy: { createdAt: "asc" }, take: 1 },
      sessions: { select: { businessDate: true }, orderBy: { businessDate: "desc" }, take: 1 },
      billingPayments: { select: { status: true, dueDate: true, valueCents: true }, orderBy: { dueDate: "desc" }, take: 1 },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    createdAt: r.createdAt,
    plan: r.billingPlan,
    cycle: r.billingCycle,
    trialEnd: r.trialEndsAt ? fromDbDate(r.trialEndsAt) : null,
    billingEmail: r.billingEmail,
    admin: r.users[0] ?? null,
    lastCashDay: r.sessions[0] ? fromDbDate(r.sessions[0].businessDate) : null,
    lastPayment: r.billingPayments[0] ? { ...r.billingPayments[0], dueDate: fromDbDate(r.billingPayments[0].dueDate) } : null,
    customPriceCents: r.customPriceCents,
    customAnnualPriceCents: r.customAnnualPriceCents,
    prices: effectivePrices(r),
  }));
}

const MAX_PRICE = 100_000_00;

/**
 * Combina o preço com um restaurante (vazio volta ao padrão). Se ele já assina, o valor da assinatura no Asaas
 * muda junto, inclusive da cobrança em aberto; o que já foi pago não muda.
 */
export async function setRestaurantPricing(
  actor: Actor,
  restaurantId: string,
  input: { monthlyCents: number | null; annualCents: number | null },
  config = asaasConfigFromEnv(),
) {
  await assertPlatformAdmin(actor);
  for (const v of [input.monthlyCents, input.annualCents]) {
    if (v !== null && (!Number.isInteger(v) || v <= 0 || v > MAX_PRICE)) throw new ServiceError("Valor inválido. Use um valor entre R$ 0,01 e R$ 100.000,00.");
  }
  const before = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!before) throw new ServiceError("Restaurante não encontrado.", "NOT_FOUND");
  const after = await prisma.restaurant.update({
    where: { id: restaurantId },
    data: { customPriceCents: input.monthlyCents, customAnnualPriceCents: input.annualCents },
  });

  let asaasUpdated = false;
  if (after.billingPlan === "SUBSCRIBED") {
    const prices = effectivePrices(after);
    const value = after.billingCycle === "YEARLY" ? prices.annual : prices.monthly;
    const old = effectivePrices(before);
    const oldValue = before.billingCycle === "YEARLY" ? old.annual : old.monthly;
    if (value && value !== oldValue) asaasUpdated = await updateSubscriptionValue(restaurantId, value, config);
  }
  await platformAudit(
    actor,
    restaurantId,
    "billing.price_set",
    { customPriceCents: before.customPriceCents, customAnnualPriceCents: before.customAnnualPriceCents },
    { customPriceCents: after.customPriceCents, customAnnualPriceCents: after.customAnnualPriceCents, asaasUpdated },
  );
  return { asaasUpdated };
}

/** Estende o teste grátis de um restaurante que ainda não assinou (até 90 dias a partir de hoje). */
export async function extendTrial(actor: Actor, restaurantId: string, untilIso: string, today = todayIso()) {
  await assertPlatformAdmin(actor);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(untilIso)) throw new ServiceError("Data inválida.");
  if (untilIso < today || untilIso > addDays(today, 90)) throw new ServiceError("Escolha uma data entre hoje e 90 dias para a frente.");
  const r = await prisma.restaurant.findUnique({ where: { id: restaurantId } });
  if (!r) throw new ServiceError("Restaurante não encontrado.", "NOT_FOUND");
  if (r.billingPlan !== "TRIAL") throw new ServiceError("Só dá para estender o teste de quem ainda está no teste grátis.", "STATE");
  await prisma.restaurant.update({ where: { id: restaurantId }, data: { trialEndsAt: toDbDate(untilIso) } });
  await platformAudit(actor, restaurantId, "billing.trial_extended", { trialEndsAt: r.trialEndsAt ? fromDbDate(r.trialEndsAt) : null }, { trialEndsAt: untilIso });
}
