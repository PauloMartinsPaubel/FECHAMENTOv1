import { NextResponse } from "next/server";
import { clientIp, getCurrentUser } from "@/server/auth/current";
import { errorMessage, ServiceError } from "@/server/errors";
import { buildFullExport } from "@/server/services/full-export";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Todos os dados do restaurante num .zip de planilhas. Só administrador. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Faça login para exportar.", { status: 401 });
  try {
    const out = await buildFullExport({ ...user, ip: await clientIp() });
    return new NextResponse(Buffer.from(out.zip), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${out.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const status = err instanceof ServiceError ? (err.code === "FORBIDDEN" ? 403 : 400) : 500;
    return new NextResponse(errorMessage(err), { status });
  }
}
