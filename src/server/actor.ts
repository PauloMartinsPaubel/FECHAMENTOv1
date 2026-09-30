import { can, Permission, RoleCode } from "@/lib/permissions";
import { ServiceError } from "./errors";

/** Quem está agindo. Toda função de serviço recebe isto. */
export interface Actor {
  userId: string;
  name: string;
  email: string;
  role: RoleCode;
  restaurantId: string;
  ip?: string | null;
}

export function assertCan(actor: Actor, permission: Permission): void {
  if (!can(actor.role, permission)) {
    throw new ServiceError("Você não tem permissão para esta ação.", "FORBIDDEN");
  }
}
