"use server";

import { revalidatePath } from "next/cache";
import type { PaymentKind } from "@/generated/prisma/client";
import type { RoleCode } from "@/lib/permissions";
import { ServiceError } from "@/server/errors";
import {
  createUser,
  resetUserPassword,
  saveChannel,
  savePaymentMethod,
  saveRegister,
  saveSettings,
  saveShift,
  saveTicketBrand,
  updateUser,
} from "@/server/services/admin";
import type { ActionState } from "./types";
import { actorFromSession, bool, moneyField, optStr, run, str } from "./util";

const ROLES: RoleCode[] = ["ADMIN", "MANAGER", "OPERATOR"];
const roleOf = (v: string): RoleCode => {
  if (!ROLES.includes(v as RoleCode)) throw new ServiceError("Papel inválido.");
  return v as RoleCode;
};

export async function createUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await createUser(actor, { name: str(fd, "name"), email: str(fd, "email"), role: roleOf(str(fd, "role")), password: String(fd.get("password") ?? "") });
    revalidatePath("/usuarios");
    return "Usuário criado. No primeiro acesso ele precisa trocar a senha.";
  });
}

export async function updateUserAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await updateUser(actor, str(fd, "userId"), { name: str(fd, "name"), role: roleOf(str(fd, "role")), active: bool(fd, "active") });
    revalidatePath("/usuarios");
    return "Usuário atualizado.";
  });
}

export async function resetPasswordAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await resetUserPassword(actor, str(fd, "userId"), String(fd.get("password") ?? ""));
    revalidatePath("/usuarios");
    return "Senha redefinida. A pessoa precisa trocá-la no próximo acesso.";
  });
}

export async function saveSettingsAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await saveSettings(actor, {
      defaultOpeningFloatCents: moneyField(fd, "defaultOpeningFloat", "o fundo padrão", { required: true })!,
      toleranceCents: moneyField(fd, "tolerance", "a tolerância", { required: true })!,
      defaultFloatMode: str(fd, "defaultFloatMode") === "TRANSFER" ? "TRANSFER" : "NEW_OPENING",
      closingRecipients: str(fd, "recipients"),
      emailFrom: optStr(fd, "emailFrom"),
      restaurantName: str(fd, "restaurantName"),
      alertRecipients: str(fd, "alertRecipients"),
      alertThresholdCents: moneyField(fd, "alertThreshold", "o limite do alerta"),
    });
    revalidatePath("/configuracoes");
    return "Configurações salvas.";
  });
}

/** Uma ação para todos os cadastros: o campo "kind" diz qual. */
export async function saveCatalogAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const kind = str(fd, "kind");
    const id = optStr(fd, "id") ?? undefined;
    const name = str(fd, "name");
    // checkbox desmarcado não é enviado: "hasActive" diz que o campo existia na tela
    const active = fd.has("hasActive") ? bool(fd, "active") : true;
    switch (kind) {
      case "channel":
        await saveChannel(actor, { id, name, isPlatform: bool(fd, "isPlatform"), active });
        break;
      case "method":
        await savePaymentMethod(actor, { id, name, kind: (optStr(fd, "methodKind") as PaymentKind | null) ?? undefined, active });
        break;
      case "brand":
        await saveTicketBrand(actor, { id, name, active });
        break;
      case "register":
        await saveRegister(actor, { id, name, active });
        break;
      case "shift":
        await saveShift(actor, { id: id ?? "", name, startTime: str(fd, "startTime"), endTime: str(fd, "endTime"), active });
        break;
      default:
        throw new ServiceError("Cadastro desconhecido.");
    }
    revalidatePath("/configuracoes");
    return id ? "Cadastro atualizado." : "Cadastro criado.";
  });
}
