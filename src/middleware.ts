import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "fc_session";

/** Endereços abertos sem login. api/cron: chamado pela Vercel sem cookie; a rota confere o CRON_SECRET. */
const PUBLIC = /^\/(login|senha\/|conheca|ir\/|cadastro|termos|privacidade|api\/cron|api\/asaas|api\/health)/;

/**
 * Política de conteúdo: o navegador só carrega estilos, imagens e vídeos do próprio site e só conversa com ele.
 * Script só roda se vier com o nonce desta resposta (um valor aleatório novo a cada página) ou se for
 * carregado por um script que veio com ele ('strict-dynamic'). Um texto malicioso que escapasse para a
 * tela não roda, nem embutido na página. 'unsafe-eval' só no desenvolvimento.
 */
function contentPolicy(nonce: string): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self'",
    "font-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "manifest-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Barreira barata: sem cookie de sessão, vai para /login.
 * A validação de verdade (token no banco, expiração, usuário ativo, permissão) acontece no servidor,
 * em cada página e em cada ação.
 */
export function middleware(req: NextRequest) {
  const policy = contentPolicy(newNonce());
  const path = req.nextUrl.pathname;
  if (!PUBLIC.test(path) && !req.cookies.get(COOKIE)?.value) {
    const url = req.nextUrl.clone();
    // quem chega pelo endereço principal sem login vê a apresentação; o resto vai para o login
    url.pathname = path === "/" ? "/conheca" : "/login";
    url.search = "";
    const res = NextResponse.redirect(url);
    res.headers.set("Content-Security-Policy", policy);
    return res;
  }
  // o Next lê o nonce da política na requisição e o coloca nos scripts que escreve na página
  const headers = new Headers(req.headers);
  headers.set("Content-Security-Policy", policy);
  const res = NextResponse.next({ request: { headers } });
  res.headers.set("Content-Security-Policy", policy);
  return res;
}

export const config = {
  // arquivos estáticos não passam por aqui: não são páginas e não precisam de nonce nem de login
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-192.png|icon-512.png|sw.js|apresentacao/|opengraph-image).*)"],
};
