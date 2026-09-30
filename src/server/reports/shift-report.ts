import { Actor, assertCan } from "../actor";
import { prisma } from "../db";
import { loadSessionBundle } from "../loaders";
import { listCorrections } from "../services/queries";
import { assertSessionAccess } from "../services/sessions";
import type { ShiftReportData } from "@/lib/reports/types";
import { buildShiftReportData } from "./shift-data";

/**
 * Dados do relatório do turno. Caixa fechado: a foto gravada no fechamento (exatamente os valores daquele fechamento).
 * Caixa aberto ou reaberto: cálculo atual, com aviso de prévia.
 */
export async function loadShiftReport(actor: Actor, sessionId: string) {
  assertCan(actor, "session.report");
  const bundle = await loadSessionBundle(prisma, actor.restaurantId, sessionId);
  assertSessionAccess(actor, bundle.session);
  const closing = bundle.session.closing;
  const frozen = closing && (bundle.session.status === "CLOSED" || bundle.session.status === "CORRECTED");
  const data: ShiftReportData = frozen ? (closing.snapshot as unknown as ShiftReportData) : buildShiftReportData(bundle);
  const corrections = await listCorrections(prisma, actor.restaurantId, sessionId);
  return { data, corrections, bundle, frozen: Boolean(frozen) };
}
