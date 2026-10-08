import { NextRequest, NextResponse } from "next/server";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { errorMessage } from "@/server/errors";
import { createDemoUnit } from "@/server/services/demo";

export const dynamic = "force-dynamic";
// seis semanas de caixas passam pelas mesmas regras de um caixa de verdade: leva alguns minutos
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return NextResponse.json({ error: "Origem inválida." }, { status: 403 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Faça login." }, { status: 401 });
  try {
    const r = await createDemoUnit({ ...user, ip: await clientIp() });
    return NextResponse.json(r);
  } catch (err) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 400 });
  }
}
