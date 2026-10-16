import { NextResponse } from "next/server";
import { clientIp } from "@/server/auth/current";
import { parsePayload } from "@/server/integrations/ecletica/payload";
import { ingestEcletica, integrationFromToken, recordEcleticaFailure } from "@/server/services/ecletica";
import { hit } from "@/server/services/rate-limit";
import { reportError } from "@/server/services/monitoring";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Bem abaixo do limite de corpo das funções da Vercel; o programa divide envios maiores. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

const json = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });

/**
 * Recebe turnos e vendas do programa instalado no restaurante (lido do Eclética B.I).
 * Autenticação: Authorization: Bearer <chave gerada em Integrações>.
 */
export async function POST(req: Request) {
  const ip = await clientIp();
  if (!(await hit("integracao", ip)).allowed) return json(429, { ok: false, erro: "Envios demais deste endereço. Tente de novo em alguns minutos." });

  const token = req.headers.get("authorization")?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const integration = await integrationFromToken(token);
  if (!integration) return json(401, { ok: false, erro: "Chave inválida. Gere uma nova em Integrações e atualize o programa." });
  if (!integration.enabled) {
    await recordEcleticaFailure(integration.id, "Envio recusado: a integração com a Eclética está desligada.");
    return json(409, { ok: false, erro: "A integração com a Eclética está desligada no sistema." });
  }

  const size = Number(req.headers.get("content-length") ?? 0);
  if (size > MAX_BODY_BYTES) return json(413, { ok: false, erro: "Envio grande demais. Mande menos turnos por vez." });
  let body: unknown;
  try {
    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return json(413, { ok: false, erro: "Envio grande demais. Mande menos turnos por vez." });
    body = JSON.parse(raw);
  } catch {
    return json(400, { ok: false, erro: "O corpo do envio não é um JSON válido." });
  }

  const parsed = parsePayload(body);
  if (!parsed.ok) {
    await recordEcleticaFailure(integration.id, parsed.error);
    return json(400, { ok: false, erro: parsed.error });
  }
  try {
    const r = await ingestEcletica(integration.restaurantId, integration.id, parsed.data);
    return json(200, { ok: true, ...r });
  } catch (err) {
    const e = err as Error;
    await recordEcleticaFailure(integration.id, `Falha ao gravar o envio: ${e.message}`);
    await reportError({ message: `Eclética: falha ao gravar envio: ${e.message}`, stack: e.stack, kind: "integração" });
    return json(500, { ok: false, erro: "Não foi possível gravar o envio. O programa tenta de novo no próximo ciclo." });
  }
}
