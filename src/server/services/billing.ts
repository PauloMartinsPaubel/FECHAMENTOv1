import { timingSafeEqual } from "node:crypto";
import { addDays, fromDbDate, todayIso, toDbDate } from "@/lib/dates";
import { cleanCpfCnpj, computeAccess, coveredUntil, isPaidStatus, TRIAL_DAYS, type AccessState, type BillingCycleCode, type BillingPlanCode } from "@/lib/billing";
import { decimalToCents } from "../integrations/shared";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { parseRecipients } from "./email";

// ---------------------------------------------------------------------------
// Cliente do Asaas (API v3). Só HTTP.
// ---------------------------------------------------------------------------

export interface AsaasConfig {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export function asaasConfigFromEnv(): AsaasConfig | null {
  const apiKey = process.env.ASAAS_API_KEY?.trim();
  if (!apiKey) return null;
  const baseUrl = process.env.ASAAS_BASE_URL?.trim() || (process.env.ASAAS_ENV === "production" ? "https://api.asaas.com/v3" : "https://api-sandbox.asaas.com/v3");
  return { baseUrl: baseUrl.replace(/\/$/, ""), apiKey };
}

export function priceCentsFromEnv(): number | null {
  const v = Number(process.env.BILLING_PRICE_CENTS);
  return Number.isInteger(v) && v > 0 ? v : null;
}

/** Valor do plano anual (pago de uma vez). Sem a variável, só existe o mensal. */
export function annualPriceCentsFromEnv(): number | null {
  const v = Number(process.env.BILLING_ANNUAL_PRICE_CENTS);
  return Number.isInteger(v) && v > 0 ? v : null;
}

async function asaas<T>(config: AsaasConfig, method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await (config.fetchImpl ?? fetch)(`${config.baseUrl}${path}`, {
      method,
      headers: { access_token: config.apiKey, "Content-Type": "application/json", "User-Agent": "fechamento-de-caixa" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    throw new ServiceError(`Não foi possível falar com o Asaas: ${(err as Error).message}`, "STATE");
  }
  const text = await res.text();
  const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  if (!res.ok) {
    const errors = (json.errors as { description?: string }[] | undefined)?.map((e) => e.description).filter(Boolean).join(" ");
    throw new ServiceError(`O Asaas recusou: ${errors || `HTTP ${res.status}`}`, "STATE");
  }
  return json as T;
}

interface AsaasPayment {
  id: string;
  status: string;
  value: number | string;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  invoiceUrl?: string | null;
  subscription?: string | null;
  externalReference?: string | null;
}

// ---------------------------------------------------------------------------
// Estado de acesso
// ---------------------------------------------------------------------------

const OPEN_OR_PAID = ["PENDING", "OVERDUE", "RECEIVED", "CONFIRMED", "RECEIVED_IN_CASH"] as const;

async function accessFor(restaurantId: string, today = todayIso()) {
  const r = await prisma.restaurant.findUniqueOrThrow({
    where: { id: restaurantId },
    select: { billingPlan: true, billingCycle: true, trialEndsAt: true },
  });
  // em aberto contam para o assinante; pagas, para saber até quando vai quem cancelou
  const payments =
    r.billingPlan === "SUBSCRIBED" || r.billingPlan === "CANCELED"
      ? await prisma.billingPayment.findMany({ where: { restaurantId, status: { in: [...OPEN_OR_PAID] } }, select: { status: true, dueDate: true, cycle: true } })
      : [];
  return computeAccess({
    plan: r.billingPlan as BillingPlanCode,
    cycle: r.billingCycle,
    trialEndDate: r.trialEndsAt ? fromDbDate(r.trialEndsAt) : null,
    payments: payments.map((p) => ({ status: p.status, dueDate: fromDbDate(p.dueDate), cycle: p.cycle })),
    today,
  });
}

export async function getAccessState(restaurantId: string): Promise<AccessState> {
  return accessFor(restaurantId);
}

/** Abrir caixa novo exige assinatura em dia (ou teste, ou isenção). */
export async function assertCanOpenCash(restaurantId: string): Promise<void> {
  const a = await accessFor(restaurantId);
  if (a.level === "readonly") throw new ServiceError(`${a.message} Fale com o administrador do restaurante.`, "STATE");
}

/** Fim do teste grátis para um restaurante criado hoje: o 14º dia, contando hoje. */
export function trialEndFrom(today: string): Date {
  return toDbDate(addDays(today, TRIAL_DAYS - 1));
}

// ---------------------------------------------------------------------------
// Tela Assinatura
// ---------------------------------------------------------------------------

export async function getBillingOverview(actor: Actor) {
  assertCan(actor, "settings.manage");
  const [restaurant, payments, access] = await Promise.all([
    prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId } }),
    prisma.billingPayment.findMany({ where: { restaurantId: actor.restaurantId }, orderBy: { dueDate: "desc" }, take: 24 }),
    accessFor(actor.restaurantId),
  ]);
  return {
    restaurant,
    payments,
    access,
    priceCents: priceCentsFromEnv(),
    annualPriceCents: annualPriceCentsFromEnv(),
    asaasReady: asaasConfigFromEnv() !== null && priceCentsFromEnv() !== null,
  };
}

/** `cycle` só vale ao criar: a cobrança nasce com o ciclo da assinatura que a gerou e não muda depois. */
async function savePayment(restaurantId: string, p: AsaasPayment, cycle: BillingCycleCode = "MONTHLY") {
  const valueCents = decimalToCents(p.value) ?? 0;
  const paidOn = p.paymentDate || p.clientPaymentDate;
  const data = {
    status: p.status,
    valueCents,
    dueDate: toDbDate(p.dueDate),
    paidAt: isPaidStatus(p.status) && paidOn ? new Date(`${paidOn}T12:00:00Z`) : null,
    invoiceUrl: p.invoiceUrl ?? null,
  };
  return prisma.billingPayment.upsert({
    where: { asaasPaymentId: p.id },
    update: data,
    create: { ...data, restaurantId, asaasPaymentId: p.id, cycle },
  });
}

/** Busca no Asaas as cobranças da assinatura (para quando o aviso automático não chegar). */
export async function syncBillingPayments(restaurantId: string, config = asaasConfigFromEnv()): Promise<number> {
  const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
  if (!r.asaasSubscriptionId || !config) return 0;
  const res = await asaas<{ data: AsaasPayment[] }>(config, "GET", `/subscriptions/${encodeURIComponent(r.asaasSubscriptionId)}/payments?limit=100`);
  for (const p of res.data ?? []) await savePayment(restaurantId, p, r.billingCycle);
  return res.data?.length ?? 0;
}

/**
 * Cria cliente e assinatura mensal no Asaas. A primeira mensalidade vence no fim do teste grátis
 * (ou hoje, se o teste já acabou). "UNDEFINED" deixa o cliente escolher PIX, boleto ou cartão na fatura.
 */
export async function subscribe(actor: Actor, input: { document: string; email: string; cycle?: string }, config = asaasConfigFromEnv(), today = todayIso()) {
  assertCan(actor, "settings.manage");
  const cycle: BillingCycleCode = input.cycle === "YEARLY" ? "YEARLY" : "MONTHLY";
  const price = cycle === "YEARLY" ? annualPriceCentsFromEnv() : priceCentsFromEnv();
  if (!config || !priceCentsFromEnv()) throw new ServiceError("A cobrança ainda não está configurada no servidor (ASAAS_API_KEY e BILLING_PRICE_CENTS).", "STATE");
  if (!price) throw new ServiceError("O plano anual não está disponível. Escolha o mensal.");
  const document = cleanCpfCnpj(input.document);
  if (!document) throw new ServiceError("CPF ou CNPJ inválido. Confira os números.");
  const [email] = parseRecipients(input.email);
  if (!email) throw new ServiceError("Informe o e-mail que recebe as faturas.");

  const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId } });
  if (r.billingPlan === "EXEMPT") throw new ServiceError("Este restaurante é isento de assinatura.", "STATE");
  if (r.billingPlan === "SUBSCRIBED" && r.asaasSubscriptionId) throw new ServiceError("A assinatura já está ativa.", "STATE");

  const customerId =
    r.asaasCustomerId ??
    (await asaas<{ id: string }>(config, "POST", "/customers", { name: r.name, cpfCnpj: document, email, externalReference: r.id, notificationDisabled: false })).id;

  // a primeira cobrança vence depois do que já está garantido (teste grátis ou mês pago antes de cancelar)
  const paid = await prisma.billingPayment.findMany({ where: { restaurantId: r.id }, select: { status: true, dueDate: true, cycle: true } });
  const until = coveredUntil(r.trialEndsAt ? fromDbDate(r.trialEndsAt) : null, paid.map((p) => ({ status: p.status, dueDate: fromDbDate(p.dueDate), cycle: p.cycle })));
  const nextDueDate = until && until >= today ? addDays(until, 1) : today;
  const sub = await asaas<{ id: string }>(config, "POST", "/subscriptions", {
    customer: customerId,
    billingType: "UNDEFINED",
    value: price / 100,
    nextDueDate,
    cycle,
    description: `Fechamento de Caixa - ${r.name}${cycle === "YEARLY" ? " (plano anual)" : ""}`,
    externalReference: r.id,
  });

  await prisma.restaurant.update({
    where: { id: r.id },
    data: { billingPlan: "SUBSCRIBED", billingCycle: cycle, billingDocument: document, billingEmail: email, asaasCustomerId: customerId, asaasSubscriptionId: sub.id },
  });
  await audit(prisma, actor, { action: "billing.subscribe", entity: "restaurant", entityId: r.id, newValue: { subscription: sub.id, cycle, nextDueDate, valueCents: price } });
  await syncBillingPayments(r.id, config).catch(() => 0);
  return { subscriptionId: sub.id, nextDueDate, cycle };
}

export async function cancelSubscription(actor: Actor, config = asaasConfigFromEnv()) {
  assertCan(actor, "settings.manage");
  const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId } });
  if (r.billingPlan !== "SUBSCRIBED" || !r.asaasSubscriptionId) throw new ServiceError("Não há assinatura ativa para cancelar.", "STATE");
  if (!config) throw new ServiceError("A cobrança não está configurada no servidor.", "STATE");
  await asaas(config, "DELETE", `/subscriptions/${encodeURIComponent(r.asaasSubscriptionId)}`);
  await prisma.restaurant.update({ where: { id: r.id }, data: { billingPlan: "CANCELED" } });
  await audit(prisma, actor, { action: "billing.cancel", entity: "restaurant", entityId: r.id, oldValue: { subscription: r.asaasSubscriptionId } });
}

// ---------------------------------------------------------------------------
// Aviso automático do Asaas (webhook)
// ---------------------------------------------------------------------------

export function webhookTokenMatches(given: string | null): boolean {
  const want = Buffer.from(process.env.ASAAS_WEBHOOK_TOKEN?.trim() ?? "");
  const got = Buffer.from((given ?? "").trim());
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

/** Recebe o evento do Asaas e grava a cobrança. Idempotente: o mesmo evento duas vezes não muda nada. */
export async function handleAsaasEvent(body: unknown): Promise<{ handled: boolean; reason?: string }> {
  const event = body as { event?: string; payment?: AsaasPayment };
  const p = event?.payment;
  if (!event?.event?.startsWith("PAYMENT_") || !p?.id) return { handled: false, reason: "evento sem cobrança" };
  const restaurant =
    (p.subscription ? await prisma.restaurant.findUnique({ where: { asaasSubscriptionId: p.subscription } }) : null) ??
    (p.externalReference ? await prisma.restaurant.findUnique({ where: { id: p.externalReference } }).catch(() => null) : null);
  if (!restaurant) return { handled: false, reason: "assinatura desconhecida" };
  const status = event.event === "PAYMENT_DELETED" ? "DELETED" : p.status;
  // cobrança de uma assinatura antiga (antes de trocar de plano) não herda o ciclo da atual
  const cycle = p.subscription && p.subscription === restaurant.asaasSubscriptionId ? restaurant.billingCycle : "MONTHLY";
  await savePayment(restaurant.id, { ...p, status }, cycle);
  await prisma.auditLog.create({
    data: {
      restaurantId: restaurant.id,
      userName: "Asaas",
      action: "billing.payment_event",
      entity: "billing_payment",
      entityId: p.id,
      newValue: { event: event.event, status, value: p.value, dueDate: p.dueDate },
    },
  });
  return { handled: true };
}
