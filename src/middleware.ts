import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "fc_session";

/**
 * Barreira barata: sem cookie de sessão, vai para /login.
 * A validação de verdade (token no banco, expiração, usuário ativo, permissão) acontece no servidor,
 * em cada página e em cada ação.
 */
export function middleware(req: NextRequest) {
  if (req.cookies.get(COOKIE)?.value) return NextResponse.next();
  const url = req.nextUrl.clone();
  // quem chega pelo endereço principal sem login vê a apresentação; o resto vai para o login
  url.pathname = req.nextUrl.pathname === "/" ? "/conheca" : "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // api/cron: chamado pela Vercel sem cookie; a rota confere o CRON_SECRET
  matcher: ["/((?!login|senha/|conheca|apresentacao/|opengraph-image|ir/|cadastro|termos|privacidade|api/cron|api/asaas|api/health|_next/static|_next/image|favicon.ico|icon.svg|manifest.webmanifest|apple-icon.png|icon-192.png|icon-512.png|sw.js).*)"],
};
