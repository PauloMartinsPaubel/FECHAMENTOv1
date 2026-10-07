import { healthCheck } from "@/server/services/monitoring";

export const dynamic = "force-dynamic";

/** Para monitor externo (ex.: UptimeRobot): 200 se tudo bem, 503 se o banco não responde. */
export async function GET() {
  const h = await healthCheck();
  return Response.json(h, { status: h.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
