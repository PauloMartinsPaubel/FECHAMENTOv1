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
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
