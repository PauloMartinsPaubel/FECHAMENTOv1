import { prisma } from "../db";

export const SITE_EVENT_KINDS = ["view", "whatsapp", "cadastro", "entrar"] as const;
export type SiteEventKind = (typeof SITE_EVENT_KINDS)[number];

/** Robôs de busca e as prévias de link (WhatsApp, Instagram, Facebook) não contam como visita. */
export function isBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true;
  return /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|skype|discord|headless|lighthouse|curl|wget|python|node-fetch|axios/i.test(userAgent);
}

/** Só o nome do site de origem (instagram.com), nunca o endereço completo. Visitas vindas do próprio site não contam como origem. */
export function sourceFromReferrer(referrer: string | null | undefined, ownHost: string | null | undefined): string | null {
  if (!referrer) return null;
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "").replace(/^l\./, "").replace(/^lm\./, "").replace(/^m\./, "");
    if (!host || (ownHost && host === ownHost.split(":")[0].replace(/^www\./, ""))) return null;
    return host.slice(0, 80);
  } catch {
    return null;
  }
}

/** Grava sem nunca derrubar a página. */
export async function recordSiteEvent(kind: SiteEventKind, source: string | null, userAgent?: string | null): Promise<void> {
  if (isBot(userAgent)) return;
  try {
    await prisma.siteEvent.create({ data: { kind, source: source?.slice(0, 80) ?? null } });
  } catch (err) {
    console.error("medição do site: falha ao gravar", err);
  }
}

export interface SiteStats {
  days: number;
  views: number;
  whatsapp: number;
  cadastro: number;
  entrar: number;
  /** cliques em WhatsApp ou cadastro por visita, em % (null sem visitas) */
  conversionPct: number | null;
  topSources: { source: string; views: number }[];
}

export async function siteStats(days: number, now = new Date()): Promise<SiteStats> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const [byKind, sources] = await Promise.all([
    prisma.siteEvent.groupBy({ by: ["kind"], where: { createdAt: { gte: since } }, _count: true }),
    prisma.siteEvent.groupBy({ by: ["source"], where: { createdAt: { gte: since }, kind: "view", source: { not: null } }, _count: true, orderBy: { _count: { source: "desc" } }, take: 5 }),
  ]);
  const n = (k: string) => byKind.find((x) => x.kind === k)?._count ?? 0;
  const views = n("view");
  const leads = n("whatsapp") + n("cadastro");
  return {
    days,
    views,
    whatsapp: n("whatsapp"),
    cadastro: n("cadastro"),
    entrar: n("entrar"),
    conversionPct: views > 0 ? Math.round((leads / views) * 1000) / 10 : null,
    topSources: sources.map((s) => ({ source: s.source ?? "", views: s._count })),
  };
}
