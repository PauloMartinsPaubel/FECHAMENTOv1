import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { TRIAL_DAYS } from "@/lib/billing";
import { SUPPORT } from "@/lib/legal/company";
import { recordSiteEvent } from "@/server/services/site-stats";

export const dynamic = "force-dynamic";

/** Botões da página de apresentação passam por aqui: conta o clique e segue para o destino. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ destino: string }> }) {
  const { destino } = await ctx.params;
  const from = (req.nextUrl.searchParams.get("de") ?? "").replace(/[^a-z]/g, "").slice(0, 20) || null;
  const ua = req.headers.get("user-agent");
  let target: string;
  let kind: "whatsapp" | "cadastro" | "entrar";
  if (destino === "whatsapp" && SUPPORT.whatsapp) {
    kind = "whatsapp";
    target = `https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(`Olá! Quero testar o Fechamento de Caixa por ${TRIAL_DAYS} dias.`)}`;
  } else if (destino === "cadastro") {
    kind = "cadastro";
    target = new URL("/cadastro", req.url).toString();
  } else if (destino === "entrar") {
    kind = "entrar";
    target = new URL("/login", req.url).toString();
  } else {
    return NextResponse.redirect(new URL("/conheca", req.url));
  }
  after(() => recordSiteEvent(kind, from, ua));
  return NextResponse.redirect(target, 302);
}
