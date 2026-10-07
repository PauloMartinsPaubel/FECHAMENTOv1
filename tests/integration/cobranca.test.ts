import { afterAll, beforeAll, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { NextRequest } from "next/server";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { registerRestaurant } from "@/server/services/signup";
import { openSession } from "@/server/services/sessions";
import { cancelSubscription, getAccessState, subscribe, syncBillingPayments } from "@/server/services/billing";
import { POST } from "@/app/api/asaas/webhook/route";
import { addDays, todayIso } from "@/lib/dates";
import type { Actor } from "@/server/actor";

/** Imita o Asaas: clientes, assinaturas e cobranças. */
class FakeAsaas {
  server!: http.Server;
  url = "";
  calls: { method: string; path: string; body: any; key: string }[] = [];
  payments: any[] = [];
  async start() {
    this.server = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (c) => (raw += c));
      req.on("end", () => {
        const body = raw ? JSON.parse(raw) : undefined;
        this.calls.push({ method: req.method!, path: req.url!, body, key: String(req.headers["access_token"] ?? "") });
        const send = (s: number, j: unknown) => { res.writeHead(s, { "Content-Type": "application/json" }); res.end(JSON.stringify(j)); };
        if (req.headers["access_token"] !== "chave-teste") return send(401, { errors: [{ description: "Chave inválida" }] });
        if (req.method === "POST" && req.url === "/customers") return send(200, { id: "cus_1" });
        if (req.method === "POST" && req.url === "/subscriptions") {
          this.payments = [{ id: "pay_1", status: "PENDING", value: 99.9, dueDate: body.nextDueDate, invoiceUrl: "https://asaas/fatura/1", subscription: "sub_1" }];
          return send(200, { id: "sub_1" });
        }
        if (req.method === "GET" && req.url?.startsWith("/subscriptions/sub_1/payments")) return send(200, { data: this.payments });
        if (req.method === "DELETE" && req.url === "/subscriptions/sub_1") return send(200, { deleted: true });
        send(404, { errors: [{ description: "não encontrado" }] });
      });
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
}

let env: Env;
const fake = new FakeAsaas();
let actor: Actor;
let restaurantId: string;
const config = () => ({ baseUrl: fake.url, apiKey: "chave-teste" });
const today = todayIso();

beforeAll(async () => {
  env = await bootstrap();
  await fake.start();
  process.env.SIGNUP_CODE = "c";
  process.env.BILLING_PRICE_CENTS = "9990";
  process.env.ASAAS_WEBHOOK_TOKEN = "token-webhook";
  const r = await registerRestaurant({ inviteCode: "c", restaurantName: "Bistrô Teste", adminName: "Ana", email: "ana@bistro.com", password: "Senha1234", passwordConfirm: "Senha1234", acceptTerms: true }, { bcryptCost: 4 });
  restaurantId = r.restaurantId;
  actor = { userId: r.userId, name: "Ana", email: "ana@bistro.com", role: "ADMIN", restaurantId };
});
afterAll(async () => {
  await new Promise<void>((r) => fake.server.close(() => r()));
  await prisma.$disconnect();
});

const register = async () => (await prisma.cashRegister.findFirstOrThrow({ where: { restaurantId } })).id;
const morning = async () => (await prisma.shift.findFirstOrThrow({ where: { restaurantId, code: "MANHA" } })).id;
const webhook = (body: unknown, token = "token-webhook") =>
  POST(new NextRequest("https://x/api/asaas/webhook", { method: "POST", body: JSON.stringify(body), headers: { "asaas-access-token": token, "content-type": "application/json" } }));

describe("cobrança pelo Asaas", () => {
  it("restaurante da instalação é isento; restaurante novo começa com 14 dias de teste", async () => {
    expect((await getAccessState(env.restaurantId)).reason).toBe("exempt");
    const r = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    expect(r.billingPlan).toBe("TRIAL");
    expect(r.trialEndsAt?.toISOString().slice(0, 10)).toBe(addDays(today, 13));
    expect((await getAccessState(restaurantId)).level).toBe("full");
  });

  it("teste vencido bloqueia abrir caixa, sem apagar nada", async () => {
    await prisma.restaurant.update({ where: { id: restaurantId }, data: { trialEndsAt: new Date(`${addDays(today, -1)}T00:00:00Z`) } });
    await expect(openSession(actor, { registerId: await register(), shiftId: await morning(), businessDate: today, openingFloatCents: 10000, floatMode: "NEW_OPENING" })).rejects.toThrow(/teste grátis terminou/);
  });

  it("assinar cria cliente e assinatura mensal com PIX, boleto ou cartão, e libera na hora", async () => {
    await expect(subscribe(actor, { document: "111.111.111-11", email: "ana@bistro.com" }, config())).rejects.toThrow(/CPF ou CNPJ inválido/);
    const r = await subscribe(actor, { document: "11.222.333/0001-81", email: "financeiro@bistro.com" }, config());
    expect(r.nextDueDate).toBe(today); // teste já tinha acabado: vence hoje
    const sub = fake.calls.find((c) => c.path === "/subscriptions")!;
    expect(sub.body).toMatchObject({ customer: "cus_1", billingType: "UNDEFINED", value: 99.9, cycle: "MONTHLY", externalReference: restaurantId });
    expect(fake.calls.find((c) => c.path === "/customers")!.body).toMatchObject({ cpfCnpj: "11222333000181", email: "financeiro@bistro.com" });
    const pay = await prisma.billingPayment.findFirstOrThrow({ where: { restaurantId } });
    expect(pay).toMatchObject({ asaasPaymentId: "pay_1", status: "PENDING", valueCents: 9990, invoiceUrl: "https://asaas/fatura/1" });
    expect((await getAccessState(restaurantId)).reason).toBe("due_soon");
    await expect(subscribe(actor, { document: "11.222.333/0001-81", email: "x@y.com" }, config())).rejects.toThrow(/já está ativa/);
  });

  it("aviso do Asaas: token errado é recusado; vencida há mais de 7 dias bloqueia; paga libera", async () => {
    expect((await webhook({ event: "PAYMENT_OVERDUE", payment: { id: "pay_1" } }, "errado")).status).toBe(401);
    const due = addDays(today, -8);
    let res = await webhook({ event: "PAYMENT_OVERDUE", payment: { id: "pay_1", status: "OVERDUE", value: 99.9, dueDate: due, subscription: "sub_1" } });
    expect(await res.json()).toMatchObject({ handled: true });
    expect((await getAccessState(restaurantId)).level).toBe("readonly");
    await expect(openSession(actor, { registerId: await register(), shiftId: await morning(), businessDate: today, openingFloatCents: 10000, floatMode: "NEW_OPENING" })).rejects.toThrow(/não paga/);

    res = await webhook({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 99.9, dueDate: due, paymentDate: today, subscription: "sub_1" } });
    expect((await getAccessState(restaurantId)).reason).toBe("active");
    const p = await prisma.billingPayment.findFirstOrThrow({ where: { asaasPaymentId: "pay_1" } });
    expect(p.paidAt?.toISOString().slice(0, 10)).toBe(today);
    // o mesmo aviso duas vezes não duplica
    await webhook({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 99.9, dueDate: due, paymentDate: today, subscription: "sub_1" } });
    expect(await prisma.billingPayment.count({ where: { restaurantId } })).toBe(1);
    const { session } = await openSession(actor, { registerId: await register(), shiftId: await morning(), businessDate: today, openingFloatCents: 10000, floatMode: "NEW_OPENING" });
    expect(session.status).toBe("OPEN");
    // evento de assinatura desconhecida não quebra
    expect(await (await webhook({ event: "PAYMENT_CREATED", payment: { id: "x", subscription: "sub_outro", status: "PENDING", value: 1, dueDate: today } })).json()).toMatchObject({ handled: false });
  });

  it("consulta manual ao Asaas e cancelamento", async () => {
    fake.payments.push({ id: "pay_2", status: "PENDING", value: "99.90", dueDate: addDays(today, 30), invoiceUrl: "https://asaas/fatura/2", subscription: "sub_1" });
    fake.payments[0] = { ...fake.payments[0], status: "RECEIVED", paymentDate: today };
    expect(await syncBillingPayments(restaurantId, config())).toBe(2);
    expect(await prisma.billingPayment.count({ where: { restaurantId } })).toBe(2);
    await expect(cancelSubscription(env.manager, config())).rejects.toMatchObject({ code: "FORBIDDEN" });
    await cancelSubscription(actor, config());
    expect((await getAccessState(restaurantId)).reason).toBe("canceled");
    expect(await prisma.auditLog.count({ where: { restaurantId, action: { in: ["billing.subscribe", "billing.cancel", "billing.payment_event"] } } })).toBeGreaterThanOrEqual(4);
  });
});
