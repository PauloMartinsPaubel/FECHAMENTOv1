import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { registerRestaurant } from "@/server/services/signup";
import { effectivePrices, getBillingOverview, subscribe } from "@/server/services/billing";
import { extendTrial, isPlatformAdmin, listRestaurantsForPlatform, setRestaurantPricing } from "@/server/services/platform";
import { addDays, todayIso } from "@/lib/dates";
import type { Actor } from "@/server/actor";

/** Imita o Asaas só no que este teste usa: cliente, assinatura, troca de valor e lista de cobranças. */
const calls: { method: string; path: string; body: any }[] = [];
let value = 0;
const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method!, path: req.url!, body });
    const send = (j: unknown) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
    if (req.url === "/customers") return send({ id: "cus_p" });
    if (req.url === "/subscriptions") { value = body.value; return send({ id: "sub_p" }); }
    if (req.method === "PUT" && req.url === "/subscriptions/sub_p") { value = body.value; return send({ id: "sub_p" }); }
    if (req.url?.startsWith("/subscriptions/sub_p/payments")) return send({ data: [{ id: "pay_p", status: "PENDING", value, dueDate: addDays(todayIso(), 20), subscription: "sub_p" }] });
    send({});
  });
});
const config = () => ({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "k" });

let env: Env;
let owner: Actor;
let client: Actor;
let clientId: string;

beforeAll(async () => {
  env = await bootstrap();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  process.env.SIGNUP_CODE = "c";
  process.env.BILLING_PRICE_CENTS = "8990";
  process.env.BILLING_ANNUAL_PRICE_CENTS = "89900";
  owner = env.admin;
  const r = await registerRestaurant({ inviteCode: "c", restaurantName: "Cantina Integrada", adminName: "Bia", email: "bia@cantina.com", password: "Senha1234", passwordConfirm: "Senha1234", acceptTerms: true }, { bcryptCost: 4 });
  clientId = r.restaurantId;
  client = { userId: r.userId, name: "Bia", email: "bia@cantina.com", role: "ADMIN", restaurantId: clientId };
});
afterAll(async () => {
  delete process.env.PLATFORM_ADMIN_EMAILS;
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.$disconnect();
});

describe("painel da plataforma e preço por restaurante", () => {
  it("só entra quem está na lista, é administrador e tem a verificação em duas etapas ligada", async () => {
    delete process.env.PLATFORM_ADMIN_EMAILS;
    expect(await isPlatformAdmin(owner)).toBe(false);
    process.env.PLATFORM_ADMIN_EMAILS = `outra@x.com, ${owner.email.toUpperCase()}`;
    expect(await isPlatformAdmin(owner)).toBe(false); // ainda sem duas etapas
    await prisma.user.update({ where: { id: owner.userId }, data: { totpEnabledAt: new Date() } });
    expect(await isPlatformAdmin(owner)).toBe(true);
    expect(await isPlatformAdmin({ ...owner, role: "MANAGER" })).toBe(false);
    expect(await isPlatformAdmin(client)).toBe(false);
    await expect(listRestaurantsForPlatform(client)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setRestaurantPricing(client, env.restaurantId, { monthlyCents: 1, annualCents: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lista todos os restaurantes com o contato do administrador", async () => {
    const rows = await listRestaurantsForPlatform(owner);
    const cantina = rows.find((r) => r.id === clientId)!;
    expect(cantina).toMatchObject({ name: "Cantina Integrada", plan: "TRIAL", admin: { name: "Bia", email: "bia@cantina.com" }, prices: { monthly: 8990, annual: 89900 } });
    expect(rows.some((r) => r.id === env.restaurantId)).toBe(true);
  });

  it("mensalidade combinada: o restaurante vê e assina pelo valor dele, e sem anual combinado não vê o anual padrão", async () => {
    await expect(setRestaurantPricing(owner, clientId, { monthlyCents: 0, annualCents: null })).rejects.toThrow(/Valor inválido/);
    await setRestaurantPricing(owner, clientId, { monthlyCents: 14990, annualCents: null }, config());
    const overview = await getBillingOverview(client);
    expect(overview).toMatchObject({ priceCents: 14990, annualPriceCents: null });
    await expect(subscribe(client, { document: "11.222.333/0001-81", email: "bia@cantina.com", cycle: "YEARLY" }, config())).rejects.toThrow(/anual não está disponível/);
    await subscribe(client, { document: "11.222.333/0001-81", email: "bia@cantina.com" }, config());
    expect(calls.find((c) => c.path === "/subscriptions")!.body).toMatchObject({ value: 149.9, cycle: "MONTHLY" });
    // os outros restaurantes continuam no padrão
    expect(effectivePrices({ customPriceCents: null, customAnnualPriceCents: null })).toEqual({ monthly: 8990, annual: 89900 });
  });

  it("mudar o preço de quem já assina atualiza o Asaas e a cobrança em aberto, e fica na auditoria do restaurante", async () => {
    const r = await setRestaurantPricing(owner, clientId, { monthlyCents: 12990, annualCents: 129900 }, config());
    expect(r.asaasUpdated).toBe(true);
    expect(calls.filter((c) => c.method === "PUT").at(-1)!.body).toEqual({ value: 129.9, updatePendingPayments: true });
    expect((await prisma.billingPayment.findFirstOrThrow({ where: { asaasPaymentId: "pay_p" } })).valueCents).toBe(12990);
    // mesmo valor de novo: não mexe no Asaas
    const before = calls.length;
    expect((await setRestaurantPricing(owner, clientId, { monthlyCents: 12990, annualCents: 129900 }, config())).asaasUpdated).toBe(false);
    expect(calls.length).toBe(before);
    const log = await prisma.auditLog.findFirstOrThrow({ where: { restaurantId: clientId, action: "billing.price_set" }, orderBy: { createdAt: "desc" } });
    expect(log.userName).toMatch(/suporte do sistema/);
  });

  it("estende o teste só de quem está no teste, até 90 dias", async () => {
    const r2 = await registerRestaurant({ inviteCode: "c", restaurantName: "Bar Novo", adminName: "Caio", email: "caio@bar.com", password: "Senha1234", passwordConfirm: "Senha1234", acceptTerms: true }, { bcryptCost: 4 });
    const today = todayIso();
    await expect(extendTrial(owner, r2.restaurantId, addDays(today, 91))).rejects.toThrow(/90 dias/);
    await expect(extendTrial(owner, r2.restaurantId, addDays(today, -1))).rejects.toThrow(/90 dias/);
    await extendTrial(owner, r2.restaurantId, addDays(today, 30));
    const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: r2.restaurantId } });
    expect(r.trialEndsAt?.toISOString().slice(0, 10)).toBe(addDays(today, 30));
    await expect(extendTrial(owner, clientId, addDays(today, 30))).rejects.toThrow(/teste grátis/); // já assina
  });
});
