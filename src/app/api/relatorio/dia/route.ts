import { NextRequest, NextResponse } from "next/server";
import { formatDateBR, isIsoDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { renderDayReport, wrapDocument } from "@/lib/reports/html";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { buildDayReport } from "@/server/services/queries";
import { errorMessage } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Faça login para ver o relatório.", { status: 401 });
  if (!can(user.role, "reports.view")) return new NextResponse("Sem permissão.", { status: 403 });
  const date = req.nextUrl.searchParams.get("data") ?? "";
  if (!isIsoDate(date)) return new NextResponse("Data inválida.", { status: 400 });
  try {
    const report = await buildDayReport({ ...user, ip: await clientIp() }, date);
    return new NextResponse(wrapDocument(`Fechamento geral do dia ${formatDateBR(date)}`, renderDayReport(report)), {
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (err) {
    return new NextResponse(errorMessage(err), { status: 400 });
  }
}
