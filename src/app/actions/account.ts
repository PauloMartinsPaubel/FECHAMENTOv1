"use server";

import { revalidatePath } from "next/cache";
import { requireUser, clientIp } from "@/server/auth/current";
import { errorMessage } from "@/server/errors";
import { confirmTwoFactorSetup, disableTwoFactor, regenerateRecoveryCodes, revokeMySession, revokeOtherSessions, setTwoFactorPolicy, startTwoFactorSetup, adminResetTwoFactor } from "@/server/services/two-factor";
import type { ActionState } from "./types";
import { actorFromSession, bool, run, str } from "./util";

export type SetupState = { step: "idle" } | { step: "scan"; qr: string; secret: string; error?: string } | { step: "codes"; codes: string[] } | { step: "error"; error: string };

/** Ligar a verificação: passo a passo com QR, código e códigos de recuperação. */
export async function twoFactorSetupAction(prev: SetupState, fd: FormData): Promise<SetupState> {
  const actor = await actorFromSession({ allowTwoFactorSetup: true });
  try {
    if (fd.get("intent") === "start") {
      const r = await startTwoFactorSetup(actor);
      return { step: "scan", qr: r.qr, secret: r.secret };
    }
    if (fd.get("intent") === "confirm" && prev.step === "scan") {
      try {
        // sem recarregar a página aqui: os códigos precisam ficar na tela até a pessoa confirmar que guardou
        const codes = await confirmTwoFactorSetup(actor, str(fd, "code"));
        return { step: "codes", codes };
      } catch (err) {
        return { ...prev, error: errorMessage(err) };
      }
    }
    return { step: "idle" };
  } catch (err) {
    return { step: "error", error: errorMessage(err) };
  }
}

export async function regenerateCodesAction(_p: { codes?: string[]; error?: string } | null, fd: FormData): Promise<{ codes?: string[]; error?: string }> {
  try {
    const codes = await regenerateRecoveryCodes(await actorFromSession(), str(fd, "code"));
    return { codes };
  } catch (err) {
    return { error: errorMessage(err) };
  }
}

export async function disableTwoFactorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await disableTwoFactor(await actorFromSession(), String(fd.get("password") ?? ""), str(fd, "code"));
    revalidatePath("/conta");
    return "Verificação em duas etapas desligada.";
  });
}

export async function revokeSessionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser({ allowTwoFactorSetup: true });
    await revokeMySession({ ...user, ip: await clientIp() }, str(fd, "sessionId"));
    revalidatePath("/conta");
    return "Sessão encerrada.";
  });
}

export async function revokeOthersAction(_p: ActionState, _fd: FormData): Promise<ActionState> {
  return run(async () => {
    const user = await requireUser({ allowTwoFactorSetup: true });
    const n = await revokeOtherSessions({ ...user, ip: await clientIp() });
    revalidatePath("/conta");
    return n ? `${n} sessão(ões) encerrada(s). Só este aparelho continua conectado.` : "Não havia outras sessões abertas.";
  });
}

export async function adminResetTwoFactorAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    await adminResetTwoFactor(await actorFromSession(), str(fd, "userId"));
    revalidatePath("/usuarios");
    return "Verificação em duas etapas desligada para essa pessoa. Ela entra só com a senha e pode ligar de novo.";
  });
}

export async function twoFactorPolicyAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const required = bool(fd, "required");
    await setTwoFactorPolicy(await actorFromSession(), required);
    revalidatePath("/configuracoes");
    return required
      ? "Pronto. Administradores e gerentes sem a verificação ligada vão ser levados a ligar no próximo acesso."
      : "A verificação em duas etapas deixou de ser obrigatória. Quem já ligou continua usando.";
  });
}
