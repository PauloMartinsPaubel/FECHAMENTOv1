import type { Prisma } from "@/generated/prisma/client";
import type { Db } from "./db";
import type { Actor } from "./actor";

export interface AuditEntry {
  action: string;
  entity?: string;
  entityId?: string;
  sessionId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string | null;
}

function toJson(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

/** Grava na trilha de auditoria. Chame dentro da mesma transação da ação auditada. */
export async function audit(db: Db, actor: Actor | null, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      restaurantId: actor?.restaurantId ?? null,
      userId: actor?.userId ?? null,
      userName: actor?.name ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      sessionId: entry.sessionId ?? undefined,
      oldValue: toJson(entry.oldValue),
      newValue: toJson(entry.newValue),
      reason: entry.reason ?? undefined,
      ip: actor?.ip ?? undefined,
    },
  });
}

export interface AdjustmentEntry {
  sessionId: string;
  closingId?: string | null;
  entity: string;
  entityId: string;
  field: string;
  oldValue: string | number | null | undefined;
  newValue: string | number | null | undefined;
  reason: string;
}

/** Registra a troca de um campo: valor anterior, novo, quem, quando e por quê. */
export async function recordAdjustment(db: Db, actor: Actor, e: AdjustmentEntry): Promise<void> {
  await db.adjustment.create({
    data: {
      restaurantId: actor.restaurantId,
      sessionId: e.sessionId,
      closingId: e.closingId ?? undefined,
      entity: e.entity,
      entityId: e.entityId,
      field: e.field,
      oldValue: e.oldValue === null || e.oldValue === undefined ? null : String(e.oldValue),
      newValue: e.newValue === null || e.newValue === undefined ? null : String(e.newValue),
      reason: e.reason,
      userId: actor.userId,
    },
  });
}
