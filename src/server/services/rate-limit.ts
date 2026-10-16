import { createHash } from "node:crypto";
import { prisma } from "../db";
import { ServiceError } from "../errors";

/** Limites por endereço de internet. Somam-se ao bloqueio por conta (5 senhas erradas) que já existe no login. */
export const LIMITS = {
  login: { limit: 30, windowMs: 15 * 60_000 },
  "senha-pedido": { limit: 5, windowMs: 60 * 60_000 },
  "senha-link": { limit: 15, windowMs: 15 * 60_000 },
  cadastro: { limit: 10, windowMs: 60 * 60_000 },
  site: { limit: 200, windowMs: 60 * 60_000 },
  "duas-etapas": { limit: 10, windowMs: 15 * 60_000 },
  /** envios do programa da Eclética (alguns por ciclo de 5 minutos) */
  integracao: { limit: 120, windowMs: 15 * 60_000 },
} as const;
export type Bucket = keyof typeof LIMITS;

/** O endereço nunca é guardado: só um hash dele, que não dá para reverter. */
const hashKey = (bucket: string, key: string) =>
  createHash("sha256").update(`${bucket}:${key}:${process.env.RATE_LIMIT_SALT ?? "fechamento-de-caixa"}`).digest("hex").slice(0, 40);

/**
 * Registra uma tentativa e diz se ainda está dentro do limite. Sem endereço conhecido, não limita
 * (o bloqueio por conta continua valendo). Falha do banco não trava ninguém.
 */
export async function hit(bucket: Bucket, key: string | null | undefined, now = new Date()): Promise<{ allowed: boolean; retryAfterMin: number }> {
  if (!key) return { allowed: true, retryAfterMin: 0 };
  const { limit, windowMs } = LIMITS[bucket];
  const keyHash = hashKey(bucket, key);
  try {
    const since = new Date(now.getTime() - windowMs);
    const recent = await prisma.rateLimitHit.findMany({ where: { bucket, keyHash, createdAt: { gt: since } }, orderBy: { createdAt: "asc" }, take: limit, select: { createdAt: true } });
    if (recent.length >= limit) {
      const freeAt = recent[0].createdAt.getTime() + windowMs;
      return { allowed: false, retryAfterMin: Math.max(1, Math.ceil((freeAt - now.getTime()) / 60_000)) };
    }
    await prisma.rateLimitHit.create({ data: { bucket, keyHash, createdAt: now } });
    return { allowed: true, retryAfterMin: 0 };
  } catch (err) {
    console.error("limite de tentativas: falha", err);
    return { allowed: true, retryAfterMin: 0 };
  }
}

/** Igual a hit, mas recusa com mensagem quando passa do limite. */
export async function enforce(bucket: Bucket, key: string | null | undefined): Promise<void> {
  const r = await hit(bucket, key);
  if (!r.allowed) throw new ServiceError(`Muitas tentativas a partir desta conexão. Tente de novo em ${r.retryAfterMin} minuto(s).`, "FORBIDDEN");
}

/** Limpeza: apaga tentativas com mais de dois dias (roda junto com a cópia de segurança da madrugada). */
export async function purgeOldHits(now = new Date()): Promise<number> {
  const r = await prisma.rateLimitHit.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * 86_400_000) } } });
  return r.count;
}
