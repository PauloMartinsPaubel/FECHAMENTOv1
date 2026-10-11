import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy as middleware } from "@/proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(new URL(path, "https://caixa.test"), { headers: cookie ? { cookie } : {} });
const nonceOf = (csp: string | null) => csp?.match(/'nonce-([^']+)'/)?.[1];

describe("middleware: login e política de conteúdo", () => {
  it("página aberta passa, com nonce novo a cada resposta e sem script embutido liberado", () => {
    const a = middleware(req("/login"));
    const b = middleware(req("/login"));
    const csp = a.headers.get("content-security-policy");
    expect(a.headers.get("location")).toBeNull();
    expect(nonceOf(csp)).toBeTruthy();
    expect(nonceOf(csp)).not.toBe(nonceOf(b.headers.get("content-security-policy")));
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).not.toContain("'unsafe-inline' 'nonce");
    expect(csp?.split("; ").find((d) => d.startsWith("script-src"))).not.toContain("unsafe-inline");
    expect(csp).toContain("frame-ancestors 'none'");
    // o Next lê o nonce da política repassada na requisição
    expect(a.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it("sem cookie: endereço principal vai para a apresentação, o resto para o login", () => {
    expect(middleware(req("/")).headers.get("location")).toBe("https://caixa.test/conheca");
    expect(middleware(req("/caixa?x=1")).headers.get("location")).toBe("https://caixa.test/login");
    expect(middleware(req("/conta/senha")).headers.get("location")).toBe("https://caixa.test/login");
    for (const open of ["/conheca", "/senha/esqueci", "/cadastro", "/termos", "/privacidade", "/ir/whatsapp", "/api/cron/backup", "/api/health", "/login/codigo"]) {
      expect(middleware(req(open)).headers.get("location"), open).toBeNull();
    }
  });

  it("com cookie de sessão passa (a validação de verdade é no servidor)", () => {
    expect(middleware(req("/caixa", "fc_session=abc")).headers.get("location")).toBeNull();
  });
});
