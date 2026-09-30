import { NextRequest, NextResponse } from "next/server";
import { formatDateBR } from "@/lib/dates";
import { renderShiftReport, wrapDocument } from "@/lib/reports/html";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { errorMessage, ServiceError } from "@/server/errors";
import { loadShiftReport } from "@/server/reports/shift-report";

export const dynamic = "force-dynamic";

/** Relatório do turno como documento HTML completo (para baixar ou abrir e imprimir). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Faça login para ver o relatório.", { status: 401 });
  const { id } = await ctx.params;
  try {
    const { data, corrections } = await loadShiftReport({ ...user, ip: await clientIp() }, id);
    const html = wrapDocument(`Fechamento ${formatDateBR(data.session.businessDate)} ${data.session.shiftName}`, renderShiftReport(data, corrections));
    const download = req.nextUrl.searchParams.get("baixar") === "1";
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        ...(download ? { "Content-Disposition": `attachment; filename="fechamento-${data.session.businessDate}-${data.session.shiftCode.toLowerCase()}.html"` } : {}),
      },
    });
  } catch (err) {
    const status = err instanceof ServiceError ? (err.code === "FORBIDDEN" ? 403 : err.code === "NOT_FOUND" ? 404 : 400) : 500;
    return new NextResponse(errorMessage(err), { status });
  }
}
