import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { IfoodClient } from "@/server/integrations/ifood/client";
import { ifoodShiftComparison, saveIfoodSettings, syncIfoodNow } from "@/server/services/integrations";
import { openSession } from "@/server/services/sessions";
import { createMovement } from "@/server/services/movements";
import { ifoodEvent, ifoodOrder } from "../fixtures/ifood";

/** Servidor que imita a Merchant API do iFood, com estado controlado pelo teste. */
class FakeIfood {
  server!: http.Server;
  url = "";
  tokens = 0;
  pending: unknown[] = [];
  acked: string[] = [];
  orders = new Map<string, unknown>();
  failOrders = new Set<string>();
  /** simula a confirmação perdida: o evento volta mesmo depois de confirmado */
  redeliver = false;
  expireNextToken = false;

  async start() {
    this.server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => this.handle(req, res, body));
    });
    await new Promise<void>((r) => this.server.listen(0, "127.0.0.1", () => r()));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  stop() {
    return new Promise<void>((r) => this.server.close(() => r()));
  }
  private handle(req: http.IncomingMessage, res: http.ServerResponse, body: string) {
    const send = (status: number, json?: unknown) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(json === undefined ? "" : JSON.stringify(json));
    };
    const url = req.url ?? "";
    if (url === "/authentication/v1.0/oauth/token") {
      const p = new URLSearchParams(body);
      if (p.get("grantType") !== "client_credentials" || p.get("clientSecret") !== "segredo") return send(401, { message: "invalid" });
      this.tokens++;
      return send(200, { accessToken: `tok-${this.tokens}`, type: "bearer", expiresIn: 21600 });
    }
    const auth = req.headers.authorization ?? "";
    if (!auth.startsWith("Bearer tok-")) return send(401);
    if (this.expireNextToken) {
      this.expireNextToken = false;
      return send(401, { message: "token expired" });
    }
    if (url === "/order/v1.0/events:polling") {
      if (req.headers["x-polling-merchants"] !== "loja-123") return send(400, { message: "merchant" });
      const out = this.pending.filter((e) => this.redeliver || !this.acked.includes((e as { id: string }).id));
      return out.length ? send(200, out) : send(204);
    }
    if (url === "/order/v1.0/events/acknowledgment" && req.method === "POST") {
      for (const e of JSON.parse(body) as { id: string }[]) this.acked.push(e.id);
      return send(202);
    }
    const m = url.match(/^\/order\/v1\.0\/orders\/(.+)$/);
    if (m) {
      const id = decodeURIComponent(m[1]);
      if (this.failOrders.has(id)) return send(500, { message: "instável" });
      const o = this.orders.get(id);
      return o ? send(200, o) : send(404);
    }
    send(404);
  }
}

let env: Env;
const fake = new FakeIfood();
const client = () => new IfoodClient({ baseUrl: fake.url, clientId: "cliente", clientSecret: "segredo" });

beforeAll(async () => {
  env = await bootstrap();
  await fake.start();
});
afterAll(async () => {
  await fake.stop();
  await prisma.$disconnect();
});

describe("configuração", () => {
  it("só o administrador configura; ligar exige o código da loja", async () => {
    await expect(saveIfoodSettings(env.manager, { merchantId: "loja-123", channelId: env.ch("iFood"), enabled: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(saveIfoodSettings(env.admin, { merchantId: "", channelId: env.ch("iFood"), enabled: true })).rejects.toThrow(/merchantId/);
    const s = await saveIfoodSettings(env.admin, { merchantId: "loja-123", channelId: env.ch("iFood"), enabled: true });
    expect(s).toMatchObject({ merchantId: "loja-123", enabled: true });
  });

  it("sem credenciais no servidor, avisa com clareza", async () => {
    delete process.env.IFOOD_CLIENT_ID;
    await expect(syncIfoodNow(env.operator)).rejects.toThrow(/credenciais do iFood/);
  });

  it("credencial errada vira mensagem clara e fica registrada", async () => {
    const bad = new IfoodClient({ baseUrl: fake.url, clientId: "cliente", clientSecret: "errado" });
    await expect(syncIfoodNow(env.operator, { client: bad })).rejects.toThrow(/recusou as credenciais/);
    const row = await prisma.platformIntegration.findFirstOrThrow();
    expect(row.lastSyncOk).toBe(false);
  });
});

describe("sincronização", () => {
  const A = "pedido-A";
  const B = "pedido-B";
  const C = "pedido-C";

  beforeEach(() => {
    fake.redeliver = false;
  });

  it("primeira busca grava os pedidos e só então confirma os eventos", async () => {
    fake.orders.set(A, ifoodOrder({ id: A, displayId: "1001", createdAt: "2026-10-06T15:30:00Z", orderAmount: 52.9 }));
    fake.orders.set(B, ifoodOrder({ id: B, displayId: "1002", createdAt: "2026-10-06T16:00:00Z", orderAmount: 40, methods: [{ value: 40, method: "CASH", type: "OFFLINE" }] }));
    fake.pending.push(ifoodEvent("ev-1", "PLC", A), ifoodEvent("ev-2", "PLC", B), ifoodEvent("ev-3", "CFM", A));
    const r = await syncIfoodNow(env.operator, { client: client() });
    expect(r).toMatchObject({ events: 3, newEvents: 3, ordersSaved: 2, acknowledged: 3, failedOrders: [] });
    const a = await prisma.platformOrder.findFirstOrThrow({ where: { externalId: A } });
    expect(a).toMatchObject({ status: "CONFIRMED", totalCents: 5290, onlineCents: 5290, offlineCents: 0, displayId: "1001" });
    expect(a.businessDate.toISOString().slice(0, 10)).toBe("2026-10-06");
    const b = await prisma.platformOrder.findFirstOrThrow({ where: { externalId: B } });
    expect([b.onlineCents, b.offlineCents]).toEqual([0, 4000]);
    expect(fake.acked).toEqual(expect.arrayContaining(["ev-1", "ev-2", "ev-3"]));
  });

  it("evento repetido (confirmação perdida) não duplica nada", async () => {
    fake.redeliver = true;
    const r = await syncIfoodNow(env.operator, { client: client() });
    expect(r.newEvents).toBe(0);
    expect(await prisma.platformOrder.count()).toBe(2);
    expect(await prisma.platformEvent.count()).toBe(3);
  });

  it("cancelamento no iFood marca o pedido como cancelado, sem apagar", async () => {
    fake.pending.push(ifoodEvent("ev-4", "CAN", B, "2026-10-06T16:10:00Z"));
    const r = await syncIfoodNow(env.operator, { client: client() });
    expect(r.cancelled).toBe(1);
    const b = await prisma.platformOrder.findFirstOrThrow({ where: { externalId: B } });
    expect(b.status).toBe("CANCELLED");
    expect(b.cancelledAt?.toISOString()).toBe("2026-10-06T16:10:00.000Z");
  });

  it("status não volta atrás: evento antigo de confirmação depois do cancelamento", async () => {
    fake.pending.push(ifoodEvent("ev-5", "CFM", B, "2026-10-06T16:05:00Z"));
    await syncIfoodNow(env.operator, { client: client() });
    expect((await prisma.platformOrder.findFirstOrThrow({ where: { externalId: B } })).status).toBe("CANCELLED");
  });

  it("se o detalhe do pedido falha, o evento não é confirmado e volta na próxima busca", async () => {
    fake.orders.set(C, ifoodOrder({ id: C, displayId: "1003", createdAt: "2026-10-06T22:30:00Z", orderAmount: 30, methods: [{ value: 30, method: "PIX", type: "ONLINE" }] }));
    fake.failOrders.add(C);
    fake.pending.push(ifoodEvent("ev-6", "PLC", C));
    const r1 = await syncIfoodNow(env.operator, { client: client() });
    expect(r1.failedOrders).toEqual([{ orderId: C, error: expect.stringContaining("HTTP 500") }]);
    expect(fake.acked).not.toContain("ev-6");
    expect(await prisma.platformOrder.count({ where: { externalId: C } })).toBe(0);

    fake.failOrders.delete(C);
    const r2 = await syncIfoodNow(env.operator, { client: client() });
    expect(r2.failedOrders).toEqual([]);
    expect(fake.acked).toContain("ev-6");
    expect(await prisma.platformOrder.count({ where: { externalId: C } })).toBe(1);
  });

  it("token vencido no meio: pega outro e segue", async () => {
    const c = client();
    await c.getToken();
    const before = fake.tokens;
    fake.expireNextToken = true;
    await expect(c.pollEvents(["loja-123"])).resolves.toBeDefined();
    expect(fake.tokens).toBe(before + 1);
  });

  it("os eventos e pedidos da plataforma não podem ser apagados", async () => {
    const o = await prisma.platformOrder.findFirstOrThrow();
    await expect(prisma.platformOrder.delete({ where: { id: o.id } })).rejects.toThrow(/não podem ser apagados/);
  });

  it("cada sincronização fica na auditoria", async () => {
    expect(await prisma.auditLog.count({ where: { action: "integration.ifood.sync" } })).toBeGreaterThanOrEqual(5);
    expect(await prisma.auditLog.count({ where: { action: "integration.ifood.sync_failed" } })).toBeGreaterThanOrEqual(1);
  });
});

describe("conferência do turno com o iFood", () => {
  it("compara o online lançado no canal iFood com o que o iFood registrou, turno a turno", async () => {
    // Manhã de 06/10: pedido A (online 52,90) e B (cancelado). Pedido C é às 19:30, tarde/noite.
    const { session } = await openSession(env.manager, {
      registerId: env.registers[2].id, shiftId: env.morning.id, businessDate: "2026-10-06", openingFloatCents: 10000, floatMode: "NEW_OPENING",
    });
    await createMovement(env.manager, session.id, {
      type: "VENDA", amountCents: 5000, orderNumber: "1001", channelId: env.ch("iFood"), paymentMethodId: env.pm("Pagamento online"),
    });
    const c = await ifoodShiftComparison(env.manager, session.id);
    expect(c).not.toBeNull();
    expect(c!).toMatchObject({
      channelName: "iFood", shiftName: "Manhã", activeCount: 1, cancelledCount: 1, cancelledCents: 4000,
      platformOnlineCents: 5290, systemOnlineCents: 5000, onlineDifferenceCents: -290,
    });
    expect(c!.orders.map((o) => o.displayId)).toEqual(["1001", "1002"]);
    expect(c!.platformOfflineByKind).toEqual({}); // o único pedido em dinheiro foi cancelado

    const { session: night } = await openSession(env.manager, {
      registerId: env.registers[3].id, shiftId: env.evening.id, businessDate: "2026-10-06", openingFloatCents: 10000, floatMode: "NEW_OPENING",
    });
    const n = await ifoodShiftComparison(env.manager, night.id);
    expect(n!).toMatchObject({ activeCount: 1, platformOnlineCents: 3000, systemOnlineCents: 0, onlineDifferenceCents: -3000 });
  });

  it("integração desligada: nada aparece na conferência", async () => {
    await saveIfoodSettings(env.admin, { merchantId: "loja-123", channelId: env.ch("iFood"), enabled: false });
    const s = await prisma.cashSession.findFirstOrThrow();
    expect(await ifoodShiftComparison(env.manager, s.id)).toBeNull();
    await expect(syncIfoodNow(env.operator, { client: client() })).rejects.toThrow(/desligada/);
  });
});
