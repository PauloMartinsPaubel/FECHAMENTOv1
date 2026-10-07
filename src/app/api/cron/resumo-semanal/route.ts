import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runWeeklySummaries } from "@/server/services/weekly";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Só a Vercel chama: ela manda "Authorization: Bearer <CRON_SECRET>". Sem o segredo configurado, recusa. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Agendado em vercel.json para segunda de manhã: manda o resumo da semana anterior de cada restaurante. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET não configurado no servidor." }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const results = await runWeeklySummaries();
  return NextResponse.json({
    sent: results.filter((r) => r.outcome.sent).length,
    results: results.map((r) => ({ restaurantId: r.restaurantId, ...r.outcome })),
  });
}
