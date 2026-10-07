import "server-only";
import { parseMoney } from "@/lib/finance";
import { clientIp, requireUser } from "@/server/auth/current";
import { errorMessage, ServiceError } from "@/server/errors";
import type { Actor } from "@/server/actor";
import type { ActionState } from "./types";
import { reportError } from "@/server/services/monitoring";

/** Usuário logado como Actor (com IP) para chamar os serviços. */
export async function actorFromSession(): Promise<Actor> {
  const user = await requireUser();
  return { ...user, ip: await clientIp() };
}

/** Executa uma ação de formulário e transforma erros de negócio em mensagem para a tela. */
export async function run(fn: () => Promise<string | void>): Promise<ActionState> {
  try {
    const message = await fn();
    return { ok: true, message: message ?? undefined };
  } catch (err) {
    // redirect() do Next lança um erro especial que precisa seguir adiante
    if (err && typeof err === "object" && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
    // erro inesperado (não é regra de negócio): vai para o monitoramento
    if (!(err instanceof ServiceError)) {
      const e = err as Error;
      await reportError({ message: e?.message || String(err), stack: e?.stack, kind: "ação" });
    }
    return { ok: false, error: errorMessage(err), code: err instanceof ServiceError ? err.code : undefined };
  }
}

export function str(fd: FormData, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

export function optStr(fd: FormData, name: string): string | null {
  const v = str(fd, name);
  return v === "" ? null : v;
}

export function moneyField(fd: FormData, name: string, label: string, opts: { required?: boolean } = {}): number | null {
  const raw = str(fd, name);
  if (raw === "") {
    if (opts.required) throw new ServiceError(`Informe ${label}.`);
    return null;
  }
  const cents = parseMoney(raw);
  if (cents === null) throw new ServiceError(`Valor inválido em ${label}. Use o formato 1.234,56.`);
  return cents;
}

export function bool(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === "on" || v === "true" || v === "1";
}
