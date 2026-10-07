import { NextResponse, type NextRequest } from "next/server";
import { handleAsaasEvent, webhookTokenMatches } from "@/server/services/billing";

export const dynamic = "force-dynamic";

/** O Asaas avisa aqui quando uma cobrança é criada, paga, vence etc. Confere o token configurado no painel do Asaas. */
export async function POST(req: NextRequest) {
  if (!webhookTokenMatches(req.headers.get("asaas-access-token"))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const r = await handleAsaasEvent(body);
  // 200 mesmo quando o evento não é nosso: senão o Asaas pausa a fila de avisos
  return NextResponse.json({ received: true, ...r });
}
