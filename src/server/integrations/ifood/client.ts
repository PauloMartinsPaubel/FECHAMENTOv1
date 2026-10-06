/**
 * Cliente da Merchant API do iFood. Só faz HTTP: não sabe nada de banco nem de caixa.
 *
 *   POST {base}/authentication/v1.0/oauth/token        (form: grantType=client_credentials, clientId, clientSecret)
 *   GET  {base}/order/v1.0/events:polling              (header x-polling-merchants; 204 = nada novo)
 *   POST {base}/order/v1.0/events/acknowledgment       (JSON: [{ "id": "<evento>" }])
 *   GET  {base}/order/v1.0/orders/{orderId}
 *
 * Caminhos conferidos em clientes públicos da API; conferir na documentação oficial ao ter acesso.
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

export interface IfoodClientConfig {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  /** para testes */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export function ifoodConfigFromEnv(): IfoodClientConfig | null {
  const clientId = process.env.IFOOD_CLIENT_ID;
  const clientSecret = process.env.IFOOD_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return {
    baseUrl: (process.env.IFOOD_BASE_URL || "https://merchant-api.ifood.com.br").replace(/\/$/, ""),
    clientId,
    clientSecret,
  };
}

export class IfoodClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: IfoodClientConfig) {
    this.fetchImpl = config.fetchImpl ?? fetch;
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
    const res = await this.request("/order/v1.0/events:polling", {
      method: "GET",
      headers: merchantIds.length ? { "x-polling-merchants": merchantIds.join(",") } : {},
    });
    if (res.status === 204) return [];
    if (!res.ok) await this.fail(res, "Falha ao buscar eventos do iFood");
    const json = await res.json().catch(() => null);
    if (!Array.isArray(json)) throw new IfoodError("Resposta de eventos do iFood não é uma lista.");
    return json;
  }

  /** Confirma o recebimento; eventos confirmados não voltam na próxima busca. */
  async acknowledge(eventIds: string[]): Promise<void> {
    if (eventIds.length === 0) return;
    const res = await this.request("/order/v1.0/events/acknowledgment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(eventIds.map((id) => ({ id }))),
    });
    if (!res.ok) await this.fail(res, "Falha ao confirmar eventos no iFood");
  }

  async getOrder(orderId: string): Promise<unknown> {
    const res = await this.request(`/order/v1.0/orders/${encodeURIComponent(orderId)}`, { method: "GET" });
    if (!res.ok) await this.fail(res, `Falha ao buscar o pedido ${orderId} no iFood`);
    return res.json();
  }
}
