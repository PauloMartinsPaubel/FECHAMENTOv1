import { NextRequest, NextResponse } from "next/server";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { errorMessage, ServiceError } from "@/server/errors";
import { buildExport, isDataset } from "@/server/reports/export";
import { isIsoDate } from "@/lib/dates";

export const dynamic = "force-dynamic";

const opt = (v: string | null) => (v && v.trim() ? v.trim() : undefined);

export async function GET(req: NextRequest, ctx: { params: Promise<{ dataset: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Faça login para exportar.", { status: 401 });
  const { dataset } = await ctx.params;
  if (!isDataset(dataset)) return new NextResponse("Exportação desconhecida.", { status: 404 });

  const q = req.nextUrl.searchParams;
  const from = opt(q.get("from"));
  const to = opt(q.get("to"));
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return new NextResponse("Período inválido.", { status: 400 });

  try {
    const out = await buildExport(
      { ...user, ip: await clientIp() },
      {
        dataset,
        from,
        to,
        sessionId: opt(q.get("sessionId")),
        shiftId: opt(q.get("shiftId")),
        registerId: opt(q.get("registerId")),
        responsibleId: opt(q.get("responsibleId")),
        includeOpen: q.get("includeOpen") === "1",
        userId: opt(q.get("userId")),
        action: opt(q.get("action")),
      },
    );
    return new NextResponse(out.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${out.filename.replace(/[^\w.\-]/g, "_")}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof ServiceError ? (err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 400) : 500;
    return new NextResponse(errorMessage(err), { status });
  }
}
