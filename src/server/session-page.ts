import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { clientIp, requireUser } from "./auth/current";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { loadSessionBundle } from "./loaders";
import { canAccessSession, editModeFor } from "./services/sessions";

/** Carrega o caixa da URL para as páginas (uma vez por requisição). Sem acesso = 404, sem revelar que existe. */
export const getSessionPage = cache(async (sessionId: string) => {
  const user = await requireUser();
  const actor = { ...user, ip: await clientIp() };
  try {
    const bundle = await loadSessionBundle(prisma, user.restaurantId, sessionId);
    if (!canAccessSession(actor, bundle.session)) notFound();
    return { user, actor, bundle, editMode: editModeFor(actor, bundle.session) };
  } catch (err) {
    if (err instanceof ServiceError) notFound();
    throw err;
  }
});

export type SessionPage = Awaited<ReturnType<typeof getSessionPage>>;
