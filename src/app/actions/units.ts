"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { RoleCode } from "@/lib/permissions";
import { clientIp, requireUser } from "@/server/auth/current";
import { createUnit, grantUnitAccess, revokeUnitAccess, switchUnit } from "@/server/services/units";
import type { ActionState } from "./types";
import { actorFromSession, run, str } from "./util";

export async function switchUnitAction(fd: FormData): Promise<void> {
  const user = await requireUser();
  await switchUnit({ ...user, ip: await clientIp() }, str(fd, "restaurantId"));
  revalidatePath("/", "layout");
  redirect("/");
}

export async function createUnitAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const r = await createUnit(actor, { name: str(fd, "name") });
    revalidatePath("/", "layout");
    return `Unidade "${r.name}" criada. Troque para ela no seletor do topo e confira canais, formas de pagamento e usuários.`;
  });
}

export async function grantAccessAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await grantUnitAccess(actor, { email: str(fd, "email"), role: str(fd, "role") as RoleCode });
    revalidatePath("/usuarios");
    return "Acesso liberado. A pessoa escolhe esta unidade no seletor do topo.";
  });
}

export async function revokeAccessAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    await revokeUnitAccess(actor, str(fd, "membershipId"));
    revalidatePath("/usuarios");
    return "Acesso removido.";
  });
}
