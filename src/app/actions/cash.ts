"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { formatBRL } from "@/lib/finance";
import { ServiceError } from "@/server/errors";
import { closeSession, reopenSession } from "@/server/services/closing";
import { saveConference } from "@/server/services/conference";
import { sendClosingEmail } from "@/server/services/email";
import {
  cancelSale,
  createMovement,
  createMovementsBatch,
  MovementInput,
  registerCancellation,
  updateMovement,
  voidMovement,
} from "@/server/services/movements";
import { correctOpeningFloat, openSession } from "@/server/services/sessions";
import { parseMoney } from "@/lib/finance";
import type { ActionState } from "./types";
import { actorFromSession, bool, moneyField, optStr, run, str } from "./util";

const refresh = (sessionId: string) => revalidatePath(`/caixa/${sessionId}`, "layout");

export async function openSessionAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let sessionId: string | null = null;
  const result = await run(async () => {
    const actor = await actorFromSession();
    const floatMode = str(fd, "floatMode") === "TRANSFER" ? "TRANSFER" : "NEW_OPENING";
    const { session } = await openSession(actor, {
      registerId: str(fd, "registerId"),
      shiftId: str(fd, "shiftId"),
      businessDate: str(fd, "businessDate"),
      openingFloatCents: moneyField(fd, "openingFloat", "o fundo de abertura", { required: true })!,
      floatMode,
      transferredFromId: floatMode === "TRANSFER" ? optStr(fd, "transferredFromId") : null,
      note: optStr(fd, "note"),
    });
    sessionId = session.id;
  });
  if (result?.ok && sessionId) redirect(`/caixa/${sessionId}`);
  return result;
}

function movementBase(fd: FormData): Pick<MovementInput, "orderNumber" | "description" | "employeeName" | "idempotencyKey" | "allowDuplicate" | "reason"> {
  return {
    orderNumber: optStr(fd, "orderNumber"),
    description: optStr(fd, "description"),
    employeeName: optStr(fd, "employeeName"),
    idempotencyKey: optStr(fd, "idempotencyKey"),
    allowDuplicate: bool(fd, "allowDuplicate"),
    reason: optStr(fd, "reason"),
  };
}

export async function addSaleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    const cents = moneyField(fd, "amount", "o valor", { required: true })!;
    const res = await createMovement(actor, sessionId, {
      type: "VENDA",
      amountCents: cents,
      channelId: optStr(fd, "channelId"),
      paymentMethodId: optStr(fd, "paymentMethodId"),
      ticketBrandId: optStr(fd, "ticketBrandId"),
      ...movementBase(fd),
    });
    refresh(sessionId);
    return res.duplicate ? "Este lançamento já tinha sido gravado." : `Venda de ${formatBRL(cents)} lançada.`;
  });
}

export async function addMovementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    const type = str(fd, "type") as MovementInput["type"];
    if (type === "VENDA") throw new ServiceError("Use o formulário de venda.");
    const cents = moneyField(fd, "amount", "o valor", { required: true })!;
    const input: MovementInput = {
      type,
      amountCents: cents,
      channelId: optStr(fd, "channelId"),
      paymentMethodId: optStr(fd, "paymentMethodId"),
      ticketBrandId: optStr(fd, "ticketBrandId"),
      ...movementBase(fd),
    };
    if (type === "AJUSTE") {
      input.adjustment = {
        direction: str(fd, "direction") === "-" ? -1 : 1,
        affectsRevenue: bool(fd, "affectsRevenue"),
        affectsCash: bool(fd, "affectsCash"),
      };
    }
    const res = await createMovement(actor, sessionId, input);
    refresh(sessionId);
    return res.duplicate ? "Este lançamento já tinha sido gravado." : `${type.charAt(0) + type.slice(1).toLowerCase()} de ${formatBRL(cents)} lançada.`;
  });
}

/** Grade canal x forma: cada campo preenchido vira uma venda. Tudo ou nada. */
export async function addGridAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    const reason = optStr(fd, "reason");
    const items: MovementInput[] = [];
    for (const [name, value] of fd.entries()) {
      if (!name.startsWith("cell:") || typeof value !== "string" || value.trim() === "") continue;
      const [, channelId, methodId, brandId] = name.split(":");
      const cents = parseMoney(value);
      if (cents === null) throw new ServiceError("Há um valor inválido na grade. Use o formato 1.234,56.");
      if (cents === 0) continue;
      items.push({
        type: "VENDA",
        amountCents: cents,
        channelId,
        paymentMethodId: methodId,
        ticketBrandId: brandId && brandId !== "-" ? brandId : null,
        description: "Lançamento em grade",
        reason,
      });
    }
    if (items.length === 0) throw new ServiceError("Preencha ao menos um valor na grade.");
    const batchKey = optStr(fd, "idempotencyKey") ?? crypto.randomUUID();
    const created = await createMovementsBatch(actor, sessionId, items, batchKey);
    refresh(sessionId);
    const total = items.reduce((a, i) => a + i.amountCents, 0);
    const fresh = created.filter((c) => !c.duplicate).length;
    return fresh === 0 ? "Esta grade já tinha sido lançada." : `${fresh} lançamento(s) somando ${formatBRL(total)}.`;
  });
}

export async function updateMovementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    await updateMovement(
      actor,
      str(fd, "movementId"),
      {
        amountCents: moneyField(fd, "amount", "o valor", { required: true })!,
        channelId: fd.has("channelId") ? optStr(fd, "channelId") : undefined,
        paymentMethodId: fd.has("paymentMethodId") ? optStr(fd, "paymentMethodId") : undefined,
        ticketBrandId: fd.has("paymentMethodId") ? optStr(fd, "ticketBrandId") : undefined,
        orderNumber: optStr(fd, "orderNumber"),
        description: optStr(fd, "description"),
      },
      str(fd, "reason"),
    );
    refresh(sessionId);
    return "Lançamento corrigido. A alteração ficou registrada.";
  });
}

export async function voidMovementAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    await voidMovement(actor, str(fd, "movementId"), str(fd, "reason"));
    refresh(sessionId);
    return "Lançamento anulado. Ele continua guardado e fora das somas.";
  });
}

export async function cancelSaleAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    await cancelSale(actor, str(fd, "movementId"), { reason: str(fd, "reason"), employeeName: optStr(fd, "employeeName") });
    refresh(sessionId);
    return "Venda cancelada e retirada do faturamento.";
  });
}

export async function registerCancellationAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    await registerCancellation(
      actor,
      sessionId,
      {
        orderNumber: str(fd, "orderNumber"),
        channelId: str(fd, "channelId"),
        paymentMethodId: optStr(fd, "paymentMethodId"),
        ticketBrandId: optStr(fd, "ticketBrandId"),
        amountCents: moneyField(fd, "amount", "o valor", { required: true })!,
        reason: str(fd, "reason"),
        employeeName: optStr(fd, "employeeName"),
      },
      bool(fd, "allowDuplicate"),
    );
    refresh(sessionId);
    return "Pedido cancelado registrado (não afeta faturamento).";
  });
}

function conferenceValues(fd: FormData): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const [name, raw] of fd.entries()) {
    if (!name.startsWith("line:") || typeof raw !== "string") continue;
    const key = name.slice(5);
    if (raw.trim() === "") {
      values[key] = null;
      continue;
    }
    const cents = parseMoney(raw);
    if (cents === null) throw new ServiceError(`Valor inválido em um dos campos de conferência: "${raw}".`);
    values[key] = cents;
  }
  return values;
}

/** Contagem por cédula e moeda: "count:mode" = on | off; quantidades em "count:<centavos>". Ausente = não mexe. */
function cashCountValues(fd: FormData): Record<string, string> | null | undefined {
  const mode = str(fd, "count:mode");
  if (mode === "off") return null;
  if (mode !== "on") return undefined;
  const out: Record<string, string> = {};
  for (const [name, raw] of fd.entries()) {
    if (!name.startsWith("count:") || name === "count:mode" || typeof raw !== "string") continue;
    out[name.slice(6)] = raw;
  }
  return out;
}

/** Botão "Conferir" grava e recalcula; botão "Fechar caixa" grava e fecha. Uma ação, duas intenções. */
export async function conferenceAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  let closed = false;
  const sessionId = str(fd, "sessionId");
  const result = await run(async () => {
    const actor = await actorFromSession();
    const intent = str(fd, "intent");
    const reason = optStr(fd, "reason");
    await saveConference(actor, sessionId, conferenceValues(fd), reason, cashCountValues(fd));
    if (intent === "close") {
      await closeSession(actor, sessionId, {
        justification: optStr(fd, "justification"),
        notes: optStr(fd, "notes"),
        correctionReason: reason,
      });
      closed = true;
      return;
    }
    return "Conferência salva e recalculada.";
  });
  refresh(sessionId);
  if (closed) redirect(`/caixa/${sessionId}/fechamento?fechado=1`);
  return result;
}

export async function reopenAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const sessionId = str(fd, "sessionId");
  const result = await run(async () => {
    const actor = await actorFromSession();
    await reopenSession(actor, sessionId, str(fd, "reason"));
  });
  refresh(sessionId);
  if (result?.ok) redirect(`/caixa/${sessionId}/fechamento`);
  return result;
}

export async function correctFloatAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  return run(async () => {
    const actor = await actorFromSession();
    const sessionId = str(fd, "sessionId");
    await correctOpeningFloat(actor, sessionId, moneyField(fd, "openingFloat", "o fundo", { required: true })!, str(fd, "reason"));
    refresh(sessionId);
    return "Fundo corrigido. A alteração ficou registrada.";
  });
}

export async function sendEmailAction(_p: ActionState, fd: FormData): Promise<ActionState> {
  const sessionId = str(fd, "sessionId");
  const result = await run(async () => {
    const actor = await actorFromSession();
    const res = await sendClosingEmail(actor, sessionId, optStr(fd, "recipients"));
    if (!res.ok) throw new ServiceError(`O fechamento está salvo, mas o e-mail não saiu: ${res.error} Use "Reenviar e-mail" quando o problema for resolvido.`);
    return `E-mail enviado (tentativa ${res.attempt}).`;
  });
  refresh(sessionId);
  return result;
}
