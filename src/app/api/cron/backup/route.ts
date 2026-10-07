import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { runNightlyBackup } from "@/server/services/backup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Só a Vercel chama: ela manda "Authorization: Bearer <CRON_SECRET>". Sem o segredo configurado, recusa. */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Agendado em vercel.json para toda madrugada: cópia de segurança de todos os dados, por e-mail. */
export async function GET(req: NextRequest) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "CRON_SECRET não configurado no servidor." }, { status: 503 });
  }
  if (!authorized(req)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const r = await runNightlyBackup();
  return NextResponse.json({ sent: r.sent, reason: r.reason, bytes: r.bytes }, { status: r.sent ? 200 : 500 });
}
