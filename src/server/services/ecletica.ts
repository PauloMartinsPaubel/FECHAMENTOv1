import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { cents, EcleticaPayload, localToUtc, PAYMENT_COLUMNS } from "../integrations/ecletica/payload";
import { hashToken } from "./auth";

/** Prefixo das chaves do programa: ajuda a reconhecer a chave e a não confundir com outras senhas. */
const TOKEN_PREFIX = "ecl_";

export type EcleticaCodeKind = "ESTABELECIMENTO" | "CANAL" | "FORMA";

export async function getEcleticaIntegration(restaurantId: string) {
  return prisma.platformIntegration.findUnique({ where: { restaurantId_provider: { restaurantId, provider: "ECLETICA" } } });
}

/**
 * Gera a chave que o programa do restaurante usa para mandar os dados. Mostrada uma vez só: aqui fica
 * guardado apenas o hash. Gerar de novo invalida a chave anterior (para quando o computador for trocado
 * ou a chave vazar).
 */
export async function generateEcleticaToken(actor: Actor): Promise<string> {
  assertCan(actor, "settings.manage");
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  await prisma.$transaction(async (tx) => {
    const before = await tx.platformIntegration.findUnique({ where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "ECLETICA" } } });
    const saved = await tx.platformIntegration.upsert({
      where: { restaurantId_provider: { restaurantId: actor.restaurantId, provider: "ECLETICA" } },
      update: { agentTokenHash: hashToken(token), enabled: true },
      create: { restaurantId: actor.restaurantId, provider: "ECLETICA", agentTokenHash: hashToken(token), enabled: true },
    });
    await audit(tx, actor, {
      action: before?.agentTokenHash ? "integration.ecletica.token_regenerated" : "integration.ecletica.token_created",
      entity: "platform_integration",
      entityId: saved.id,
    });
  });
  return token;
}

export async function setEcleticaEnabled(actor: Actor, enabled: boolean) {
  assertCan(actor, "settings.manage");
  const row = await getEcleticaIntegration(actor.restaurantId);
  if (!row) throw new ServiceError("Gere a chave do programa primeiro.", "STATE");
  await prisma.$transaction(async (tx) => {
    await tx.platformIntegration.update({ where: { id: row.id }, data: { enabled } });
    await audit(tx, actor, { action: "integration.ecletica.settings", entity: "platform_integration", entityId: row.id, oldValue: { enabled: row.enabled }, newValue: { enabled } });
  });
}

export interface IngestResult {
  turnos: number;
  vendas: number;
  sangrias: number;
  /** turnos abertos que chegaram depois do turno já fechado: o fechado vale */
  ignorados: number;
}

/** Quem está mandando: a chave do programa diz de qual restaurante são os dados. */
export async function integrationFromToken(token: string | null | undefined) {
  if (!token || !token.startsWith(TOKEN_PREFIX) || token.length > 200) return null;
  const row = await prisma.platformIntegration.findUnique({ where: { agentTokenHash: hashToken(token) } });
  return row && row.provider === "ECLETICA" ? row : null;
}

/**
 * Grava um envio do programa. Cada turno recebido substitui o que havia daquele turno (vendas e sangrias
 * inclusive), do jeito que o Eclética B.I recarrega um turno inteiro quando ele muda. Tudo numa transação:
 * nenhuma tela vê um turno pela metade.
 */
export async function ingestEcletica(restaurantId: string, integrationId: string, payload: EcleticaPayload, now = new Date()): Promise<IngestResult> {
  const result: IngestResult = { turnos: 0, vendas: 0, sangrias: 0, ignorados: 0 };
  // o mesmo turno duas vezes no envio: vale o fechado e, entre iguais, o último
  const byCode = new Map<string, EcleticaPayload["turnos"][number]>();
  for (const t of payload.turnos) {
    const prev = byCode.get(t.codigo);
    if (!prev || !t.aberto || prev.aberto) byCode.set(t.codigo, t);
  }
  const turnos = [...byCode.values()];

  const codes = new Map<string, { kind: EcleticaCodeKind; externalKey: string; label: string | null }>();
  const seen = (kind: EcleticaCodeKind, externalKey: string, label: string | null = null) => {
    const k = `${kind}|${externalKey}`;
    const prev = codes.get(k);
    if (!prev || (label && !prev.label)) codes.set(k, { kind, externalKey, label: label ?? prev?.label ?? null });
  };
  for (const f of payload.catalogo.formas ?? []) seen("FORMA", `${f.tipoDet}|${f.codDet}`, f.descricao);
  for (const c of payload.catalogo.canais ?? []) seen("CANAL", `${c.flagDely}|${c.origem}`, c.integrador);
  for (const e of payload.catalogo.estabelecimentos ?? []) seen("ESTABELECIMENTO", e.codigo, e.nome);

  await prisma.$transaction(
    async (tx) => {
      for (const t of turnos) {
        const existing = await tx.ecleticaShift.findUnique({ where: { restaurantId_externalId: { restaurantId, externalId: t.codigo } } });
        // a foto do turno aberto (tempo real) nunca passa por cima do turno já fechado
        if (t.aberto && existing && !existing.open) {
          result.ignorados++;
          continue;
        }
        const openedAt = localToUtc(t.abertura);
        if (!openedAt) throw new ServiceError(`Turno ${t.codigo}: data de abertura inválida.`);
        const data = {
          openedAt,
          closedAt: t.aberto ? null : localToUtc(t.fechamento),
          open: t.aberto,
          floatCents: cents(t.fundo),
          closingCents: t.valorFechamento == null ? null : cents(t.valorFechamento),
          machine: t.maquina,
          operatorCode: t.operador,
          receivedAt: now,
        };
        const shift = existing
          ? await tx.ecleticaShift.update({ where: { id: existing.id }, data })
          : await tx.ecleticaShift.create({ data: { ...data, restaurantId, externalId: t.codigo } });
        if (existing) {
          await tx.ecleticaSale.deleteMany({ where: { shiftId: shift.id } });
          await tx.ecleticaCashMove.deleteMany({ where: { shiftId: shift.id } });
        }

        const sales = [...new Map(t.vendas.map((v) => [v.chave, v])).values()];
        const rows: Prisma.EcleticaSaleCreateManyInput[] = sales.map((v) => {
          const byColumn: Record<string, number> = {};
          for (const col of PAYMENT_COLUMNS) {
            const c = cents(v.colunas[col]);
            if (c !== 0) {
              byColumn[col] = c;
              seen("FORMA", col, null);
            }
          }
          const details = v.detalhes.map((d) => {
            seen("FORMA", `${d.tipoDet}|${d.codDet}`, null);
            return { key: `${d.tipoDet}|${d.codDet}`, valueCents: cents(d.valor) };
          });
          if (v.estabelecimento) seen("ESTABELECIMENTO", v.estabelecimento, null);
          if (v.tipo || v.origem) seen("CANAL", `${v.tipo ?? ""}|${v.origem ?? ""}`, null);
          return {
            restaurantId,
            shiftId: shift.id,
            externalKey: v.chave,
            establishment: v.estabelecimento,
            openedAt: localToUtc(v.abertura),
            closedAt: localToUtc(v.fechamento),
            saleType: v.tipo,
            origin: v.origem,
            status: v.situacao,
            totalCents: cents(v.total),
            discountCents: cents(v.desconto),
            serviceCents: cents(v.servico),
            byColumn,
            changeCents: cents(v.troco),
            tipCents: cents(v.repique),
            details,
            externalOrderId: v.pedidoExterno,
            cancelledAt: localToUtc(v.canceladaEm),
            cancelReason: v.motivoCancelamento,
          };
        });
        if (rows.length) await tx.ecleticaSale.createMany({ data: rows });
        if (t.sangrias.length) {
          await tx.ecleticaCashMove.createMany({
            data: t.sangrias.map((s) => ({
              shiftId: shift.id,
              occurredAt: localToUtc(s.data),
              operator: s.operador,
              dCents: cents(s.d),
              tCents: cents(s.t),
              cCents: cents(s.c),
              type: s.tipo,
              reason: s.motivo,
            })),
          });
        }
        result.turnos++;
        result.vendas += rows.length;
        result.sangrias += t.sangrias.length;
      }

      for (const c of codes.values()) {
        await tx.ecleticaCode.upsert({
          where: { restaurantId_kind_externalKey: { restaurantId, kind: c.kind, externalKey: c.externalKey } },
          update: { lastSeenAt: now, ...(c.label ? { label: c.label } : {}) },
          create: { restaurantId, kind: c.kind, externalKey: c.externalKey, label: c.label, lastSeenAt: now },
        });
      }

      await tx.platformIntegration.update({
        where: { id: integrationId },
        data: {
          lastSyncAt: now,
          lastSyncOk: true,
          agentVersion: payload.versao,
          lastSyncInfo: `${result.turnos} turno(s), ${result.vendas} venda(s) e ${result.sangrias} sangria(s) recebidos${result.ignorados ? `; ${result.ignorados} turno(s) aberto(s) ignorado(s) porque já tinham fechado` : ""}.`,
        },
      });
    },
    { timeout: 60_000 },
  );
  return result;
}

/** Registra um envio recusado (dados inválidos ou integração desligada) para aparecer na tela de Integrações. */
export async function recordEcleticaFailure(integrationId: string, message: string, now = new Date()) {
  await prisma.platformIntegration
    .update({ where: { id: integrationId }, data: { lastSyncAt: now, lastSyncOk: false, lastSyncInfo: message.slice(0, 500) } })
    .catch(() => undefined);
}

/** Situação da integração para a tela: último envio e o que chegou nos últimos dias. */
export async function ecleticaStatus(actor: Actor, now = new Date()) {
  assertCan(actor, "reports.view");
  const since = new Date(now.getTime() - 7 * 86_400_000);
  const [row, shifts, sales, codes] = await Promise.all([
    getEcleticaIntegration(actor.restaurantId),
    prisma.ecleticaShift.count({ where: { restaurantId: actor.restaurantId, openedAt: { gte: since } } }),
    prisma.ecleticaSale.count({ where: { restaurantId: actor.restaurantId, shift: { openedAt: { gte: since } } } }),
    prisma.ecleticaCode.findMany({ where: { restaurantId: actor.restaurantId }, orderBy: [{ kind: "asc" }, { externalKey: "asc" }] }),
  ]);
  return {
    configured: Boolean(row?.agentTokenHash),
    enabled: row?.enabled ?? false,
    lastSyncAt: row?.lastSyncAt ?? null,
    lastSyncOk: row?.lastSyncOk ?? null,
    lastSyncInfo: row?.lastSyncInfo ?? null,
    agentVersion: row?.agentVersion ?? null,
    shifts7d: shifts,
    sales7d: sales,
    codes,
  };
}
