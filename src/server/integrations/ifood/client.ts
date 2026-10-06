/**
 * Cliente da Merchant API do iFood. Só faz HTTP: não sabe nada de banco nem de caixa.
 *
 *   POST {base}/authentication/v1.0/oauth/token   (form: grantType=client_credentials, clientId, clientSecret)
 *   GET  {base}/order/v1.0/orders/{id}
 *   GET  {base}/merchant/v1.0/merchants          lojas que autorizaram o aplicativo (para achar o merchantId)
 *
 * Eventos: a documentação oficial traz duas rotas, e as duas páginas não batem entre si.
 *   "events" (introdução do módulo Events, base /events/v1.0):
 *     GET  /events/v1.0/events:polling           resposta: lista de eventos, ou 204 sem nada
 *     POST /events/v1.0/events/acknowledgment    corpo: [{ "id": "<evento>" }]
 *   "orders" (página Endpoints do módulo Order):
 *     GET  /order/v1.0/orders:polling            resposta: { "events": [...] }
 *     POST /order/v1.0/orders:acknowledgment     corpo: { "acknowledgedEventIds": ["<evento>"] }
 * O cliente começa pela rota "events"; se ela não existir para o aplicativo (403, 404 ou 405), usa "orders"
 * e guarda a escolha. Na confirmação, se o iFood recusar o formato do corpo (400, 415 ou 422), manda no outro.
 * IFOOD_EVENTS_ROUTE=events|orders fixa a rota e desliga a tentativa.
 */

export class IfoodError extends Error {
  constructor(
    message: string,
    public readonly status: number | null = null,
  ) {
    super(message);
    this.name = "IfoodError";
  }
}

export interface IfoodMerchant {
  id: string;
  name: string | null;
  corporateName: string | null;
}

export type IfoodEventsRoute = "events" | "orders";

const EVENTS_ROUTES: Record<IfoodEventsRoute, { polling: string; ack: string }> = {
  events: { polling: "/events/v1.0/events:polling", ack: "/events/v1.0/events/acknowledgment" },
  orders: { polling: "/order/v1.0/orders:polling", ack: "/order/v1.0/orders:acknowledgment" },
};

/** Rota não habilitada ou inexistente para este aplicativo: vale tentar a outra. */
const ROUTE_MISSING = new Set([403, 404, 405]);
/** Corpo em formato que o iFood não aceita: vale mandar no outro formato. */
const BODY_REJECTED = new Set([400, 415, 422]);

export interface IfoodClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** fixa a rota de eventos; sem isso, o cliente descobre sozinho */
  eventsRoute?: IfoodEventsRoute;
  /** para testes */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function ifoodConfigFromEnv(): IfoodClientConfig | null {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  const route = process.env.IFOOD_EVENTS_ROUTE;
  return {
    baseUrl: (process.env.IFOOD_BASE_URL || "https://merchant-api.ifood.com.br").replace(/\/$/, ""),
    clientId,
    clientSecret,
    eventsRoute: route === "events" || route === "orders" ? route : undefined,
  };
}

export class IfoodClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;
  private route: IfoodEventsRoute;
  private routeKnown: boolean;

  constructor(private readonly config: IfoodClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.route = config.eventsRoute ?? "events";
    this.routeKnown = config.eventsRoute !== undefined;
  }

  /** Rota de eventos em uso (fica registrada na auditoria da sincronização). */
  get eventsRoute(): IfoodEventsRoute {
    return this.route;
  }

  private async request(path: string, init: RequestInit, auth = true, retried = false): Promise<Response> {
    const headers = new Headers(init.headers);
    if (auth) headers.set("Authorization", `Bearer ${await this.getToken()}`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.config.baseUrl}${path}`, {
        ...init,
        headers,
        signal: AbortSignal.timeout(this.config.timeoutMs ?? 15_000),
      });
    } catch (err) {
      throw new IfoodError(`Não foi possível falar com o iFood: ${(err as Error).message}`);
    }
    // token vencido ou revogado: pega outro e tenta uma vez
    if (res.status === 401 && auth && !retried) {
      this.token = null;
      return this.request(path, init, auth, true);
    }
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const body = await res.text().catch(() => "");
    throw new IfoodError(`${what}: HTTP ${res.status}${body ? ` ${body.slice(0, 300)}` : ""}`, res.status);
  }

  async getToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const res = await this.request(
      "/authentication/v1.0/oauth/token",
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grantType: "client_credentials",
          clientId: this.config.clientId,
          clientSecret: this.config.clientSecret,
        }).toString(),
      },
      false,
    );
    if (!res.ok) await this.fail(res, "O iFood recusou as credenciais");
    const json = (await res.json()) as { accessToken?: string; expiresIn?: number };
    if (!json.accessToken) throw new IfoodError("Resposta de autenticação do iFood sem accessToken.");
    this.token = { value: json.accessToken, expiresAt: Date.now() + (json.expiresIn ?? 3600) * 1000 };
    return this.token.value;
  }

  /** Eventos pendentes (pedidos novos, confirmados, cancelados...). Vazio quando não há nada. */
  async pollEvents(merchantIds: string[]): Promise<unknown[]> {
    const headers: Record<string, string> = merchantIds.length ? { "x-polling-merchants": merchantIds.join(",") } : {};
    let res = await this.request(EVENTS_ROUTES[this.route].polling, { method: "GET", headers });
    if (!this.routeKnown && ROUTE_MISSING.has(res.status)) {
      const first = `${this.route}: HTTP ${res.status}`;
      this.route = this.route === "events" ? "orders" : "events";
      res = await this.request(EVENTS_ROUTES[this.route].polling, { method: "GET", headers });
      if (!res.ok && res.status !== 204) await this.fail(res, `Falha ao buscar eventos do iFood (${first}; ${this.route})`);
    }
    if (res.status === 204) {
      this.routeKnown = true;
      return [];
    }
    if (!res.ok) await this.fail(res, "Falha ao buscar eventos do iFood");
    this.routeKnown = true;
    const text = await res.text();
    if (!text.trim()) return [];
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new IfoodError("Resposta de eventos do iFood não é JSON.");
    }
    if (Array.isArray(json)) return json;
    const wrapped = json && typeof json === "object" ? (json as { events?: unknown }).events : undefined;
    if (Array.isArray(wrapped)) return wrapped;
    throw new IfoodError("Resposta de eventos do iFood em formato desconhecido (nem lista, nem { events: [...] }).");
  }

  /** Confirma o recebimento; eventos confirmados não voltam na próxima busca. */
  async acknowledge(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const asObjects = JSON.stringify(eventIds.map((id) => ({ id })));
    const asIds = JSON.stringify({ acknowledgedEventIds: eventIds });
    const bodies = this.route === "orders" ? [asIds, asObjects] : [asObjects, asIds];
    const post = (body: string) =>
      this.request(EVENTS_ROUTES[this.route].ack, { method: "POST", headers: { "Content-Type": "application/json" }, body });
    let res = await post(bodies[0]);
    if (BODY_REJECTED.has(res.status)) res = await post(bodies[1]);
    if (!res.ok) await this.fail(res, "Falha ao confirmar eventos no iFood");
  }

  /**
   * Lojas que este aplicativo pode ler (módulo Merchant). Serve para achar o merchantId sem procurar no portal.
   * Só lê a primeira página: um restaurante tem poucas lojas.
   */
  async listMerchants(): Promise<IfoodMerchant[]> {
    const res = await this.request("/merchant/v1.0/merchants", { method: "GET" });
    if (res.status === 204) return [];
    if (!res.ok) await this.fail(res, "Falha ao listar as lojas no iFood");
    const json = (await res.json().catch(() => null)) as unknown;
    const list = Array.isArray(json) ? json : Array.isArray((json as { merchants?: unknown })?.merchants) ? (json as { merchants: unknown[] }).merchants : null;
    if (!list) throw new IfoodError("Resposta de lojas do iFood em formato desconhecido.");
    const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return list.flatMap((m) => {
      const o = (m ?? {}) as Record<string, unknown>;
      const id = text(o.id);
      return id ? [{ id, name: text(o.name), corporateName: text(o.corporateName) }] : [];
    });
  }

  async getOrder(orderId: string): Promise<unknown> {
    const res = await this.request(`/order/v1.0/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
    if (!res.ok) await this.fail(res, `Falha ao buscar o pedido ${orderId} no iFood`);
    return res.json();
  }
}
