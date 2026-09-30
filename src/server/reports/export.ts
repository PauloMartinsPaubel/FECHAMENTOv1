import { formatDateBR, formatDateTimeBR, fromDbDate } from "@/lib/dates";
import { formatDecimalComma, KIND_LABEL } from "@/lib/finance";
import { CsvCell, moneyCell as $, toCsv } from "@/lib/reports/csv";
import {
  FLOAT_MODE_LABEL,
  MOVEMENT_STATUS_LABEL,
  MOVEMENT_TYPE_LABEL,
  SESSION_STATUS_LABEL,
  statusShort,
} from "@/lib/reports/labels";
import { can } from "@/lib/permissions";
import { Actor } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { auditWhere, EvaluatedSession, loadEvaluatedSessions, SessionFilter } from "../services/queries";

export const DATASETS = [
  "fechamento",
  "vendas",
  "conferencia",
  "cartoes",
  "dinheiro",
  "tickets",
  "pix",
  "movimentacoes",
  "cancelamentos",
  "divergencias",
  "auditoria",
] as const;
export type Dataset = (typeof DATASETS)[number];

export const DATASET_LABEL: Record<Dataset, string> = {
  fechamento: "Fechamentos",
  vendas: "Vendas",
  conferencia: "Conferência (todas as linhas)",
  cartoes: "Cartões",
  dinheiro: "Dinheiro",
  tickets: "Tickets",
  pix: "PIX",
  movimentacoes: "Movimentações",
  cancelamentos: "Cancelamentos",
  divergencias: "Divergências",
  auditoria: "Auditoria",
};

export interface ExportParams {
  dataset: Dataset;
  from?: string;
  to?: string;
  sessionId?: string;
  shiftId?: string;
  registerId?: string;
  responsibleId?: string;
  includeOpen?: boolean;
  // auditoria
  userId?: string;
  action?: string;
}

export function isDataset(value: string): value is Dataset {
  return (DATASETS as readonly string[]).includes(value);
}

const COMMON = [
  "ID", "Data", "Turno", "Caixa", "Responsável", "Canal", "Forma de pagamento", "Tipo",
  "Valor registrado", "Valor conferido", "Diferença", "Descrição", "Status",
];

function base(s: EvaluatedSession) {
  return {
    date: formatDateBR(fromDbDate(s.session.businessDate)),
    shift: s.session.shift.name,
    register: s.session.register.name,
    responsible: s.session.responsible.name,
  };
}

const GROUPS_BY_DATASET: Partial<Record<Dataset, string[]>> = {
  cartoes: ["CREDIT", "DEBIT"],
  dinheiro: ["CASH"],
  tickets: ["TICKET"],
  pix: ["PIX"],
};

function conferenceRows(sessions: EvaluatedSession[], groups: string[] | null, onlyDivergent: boolean): CsvCell[][] {
  const rows: CsvCell[][] = [];
  for (const s of sessions) {
    const b = base(s);
    const { summary } = s.evaluation;
    const channelName = new Map(s.movements.filter((m) => m.channelId && m.channel).map((m) => [m.channelId as string, m.channel!.name]));
    for (const l of s.evaluation.lines) {
      if (groups && !groups.includes(l.group)) continue;
      if (onlyDivergent && (l.differenceCents === null || l.differenceCents === 0)) continue;
      if (!onlyDivergent && !l.required && l.checkedCents === null) continue;
      let description = "";
      if (l.group === "CASH") {
        description = `Vendas em dinheiro ${fmt(summary.cash.salesCents)} + fundo ${fmt(summary.cash.floatCents)} + suprimentos ${fmt(summary.cash.suppliesCents)} - sangrias ${fmt(summary.cash.withdrawalsCents)} - despesas ${fmt(summary.cash.expensesCents)} - estornos ${fmt(summary.cash.refundsCents)}${summary.cash.adjustmentsCents ? ` +/- ajustes ${fmt(summary.cash.adjustmentsCents)}` : ""}`;
      }
      if (onlyDivergent && s.session.closing?.justification) {
        description = `Justificativa: ${s.session.closing.justification}`;
      }
      rows.push([
        `${s.session.id.slice(0, 8)}:${l.key}`, b.date, b.shift, b.register, b.responsible,
        l.channelId ? (channelName.get(l.channelId) ?? "") : "",
        l.fullLabel, KIND_LABEL[l.group],
        $(l.expectedCents), $(l.checkedCents), $(l.differenceCents), description,
        l.checkedCents === null ? "Pendente" : l.differenceCents === 0 ? "Conferido" : l.differenceCents! < 0 ? "Falta" : "Sobra",
      ]);
    }
  }
  return rows;
}

const fmt = (c: number) => formatDecimalComma(c);

export function assertCanExport(actor: Actor, params: ExportParams): void {
  if (params.dataset === "auditoria") {
    if (!can(actor.role, "audit.view")) throw new ServiceError("Somente o administrador exporta a auditoria.", "FORBIDDEN");
    return;
  }
  if (can(actor.role, "export.all")) return;
  // operador: só o caixa dele, e nada de fechamento de outros dias
  if (!params.sessionId) throw new ServiceError("Operadores exportam apenas o caixa em que estão trabalhando.", "FORBIDDEN");
  if (!can(actor.role, "session.report")) throw new ServiceError("Sem permissão para exportar.", "FORBIDDEN");
}

export async function buildExport(actor: Actor, params: ExportParams): Promise<{ filename: string; csv: string; rows: number }> {
  assertCanExport(actor, params);

  let headers: string[] = COMMON;
  let rows: CsvCell[][] = [];
  let label = params.dataset as string;

  if (params.dataset === "auditoria") {
    const logs = await prisma.auditLog.findMany({
      where: auditWhere(actor, { from: params.from, to: params.to, userId: params.userId, action: params.action, sessionId: params.sessionId }),
      orderBy: { createdAt: "desc" },
      take: 50_000,
    });
    headers = ["ID", "Data e hora", "Usuário", "Ação", "Registro", "ID do registro", "ID do caixa", "Valor anterior", "Valor novo", "Motivo", "IP"];
    rows = logs.map((l) => [
      l.id, formatDateTimeBR(l.createdAt), l.userName ?? "", l.action, l.entity ?? "", l.entityId ?? "", l.sessionId ?? "",
      l.oldValue === null ? "" : JSON.stringify(l.oldValue), l.newValue === null ? "" : JSON.stringify(l.newValue), l.reason ?? "", l.ip ?? "",
    ]);
  } else {
    let filter: SessionFilter;
    if (params.sessionId) {
      const s = await prisma.cashSession.findFirst({ where: { id: params.sessionId, restaurantId: actor.restaurantId } });
      if (!s) throw new ServiceError("Caixa não encontrado.", "NOT_FOUND");
      const d = fromDbDate(s.businessDate);
      filter = { from: d, to: d, sessionIds: [s.id] };
      label = `${fromDbDate(s.businessDate)}`;
    } else {
      if (!params.from || !params.to) throw new ServiceError("Informe o período.");
      filter = {
        from: params.from, to: params.to, shiftId: params.shiftId, registerId: params.registerId, responsibleId: params.responsibleId,
        statuses: params.includeOpen ? undefined : ["CLOSED", "CORRECTED"],
      };
      label = `${params.from}_${params.to}`;
    }
    const { sessions } = await loadEvaluatedSessions(prisma, actor, filter);
    if (params.sessionId && sessions.length === 0) throw new ServiceError("Você não tem acesso a este caixa.", "FORBIDDEN");

    switch (params.dataset) {
      case "fechamento": {
        headers = [
          "ID", "Data", "Turno", "Caixa", "Responsável", "Fechado por", "Fechado em", "Revisão", "Situação do caixa", "Fundo de abertura", "Faturamento",
          "Dinheiro", "Crédito", "Débito", "Total cartões", "PIX", "Tickets", "Online", "Outros", "Sangrias", "Suprimentos", "Despesas",
          "Cancelamentos", "Estornos", "Valores controlados", "Dinheiro esperado", "Dinheiro contado", "Diferença dinheiro", "Diferença cartões",
          "Diferença PIX", "Diferença tickets", "Diferença online", "Divergência total", "Soma dos módulos", "Status", "Justificativa", "Observações",
        ];
        for (const s of sessions) {
          const c = s.session.closing;
          if (!c) continue;
          const b = base(s);
          rows.push([
            c.id, b.date, b.shift, b.register, b.responsible, s.session.closedBy?.name ?? "", formatDateTimeBR(c.closedAt), c.revision,
            SESSION_STATUS_LABEL[s.session.status], $(c.floatCents), $(c.revenueCents), $(c.cashSalesCents), $(c.creditCents), $(c.debitCents), $(c.cardsCents),
            $(c.pixCents), $(c.ticketsCents), $(c.onlineCents), $(c.otherCents), $(c.withdrawalsCents), $(c.suppliesCents), $(c.expensesCents),
            $(c.cancellationsCents), $(c.refundsCents), $(c.controlledCents), $(c.cashExpectedCents), $(c.cashCountedCents), $(c.cashDiffCents),
            $(c.cardsDiffCents), $(c.pixDiffCents), $(c.ticketsDiffCents), $(c.onlineDiffCents), $(c.totalDiffCents), $(c.absDiffCents),
            statusShort(c.status), c.justification ?? "", c.notes ?? "",
          ]);
        }
        break;
      }
      case "vendas": {
        for (const s of sessions) {
          const b = base(s);
          for (const m of s.movements.filter((x) => x.type === "VENDA")) {
            rows.push([
              m.id, b.date, b.shift, b.register, b.responsible, m.channel?.name ?? "",
              m.ticketBrand ? `${m.paymentMethod?.name} / ${m.ticketBrand.name}` : (m.paymentMethod?.name ?? ""),
              "Venda", $(m.amountCents), null, null,
              [m.orderNumber ? `Pedido ${m.orderNumber}` : "", `lançado por ${m.createdBy.name}`, m.description ?? ""].filter(Boolean).join("; "),
              MOVEMENT_STATUS_LABEL[m.status],
            ]);
          }
        }
        break;
      }
      case "conferencia":
      case "cartoes":
      case "dinheiro":
      case "tickets":
      case "pix":
        rows = conferenceRows(sessions, GROUPS_BY_DATASET[params.dataset] ?? null, false);
        break;
      case "divergencias":
        rows = conferenceRows(sessions, null, true);
        break;
      case "movimentacoes": {
        headers = [...COMMON, "Impacto no faturamento", "Impacto no saldo físico"];
        for (const s of sessions) {
          const b = base(s);
          rows.push([
            `${s.session.id}:fundo`, b.date, b.shift, b.register, b.responsible, "", "Dinheiro", MOVEMENT_TYPE_LABEL.FUNDO_ABERTURA,
            $(s.session.openingFloatCents), null, null, FLOAT_MODE_LABEL[s.session.floatMode], "Ativo", $(0), $(s.session.openingFloatCents),
          ]);
          for (const m of s.movements) {
            rows.push([
              m.id, b.date, b.shift, b.register, b.responsible, m.channel?.name ?? "",
              m.ticketBrand ? `${m.paymentMethod?.name} / ${m.ticketBrand.name}` : (m.paymentMethod?.name ?? ""),
              MOVEMENT_TYPE_LABEL[m.type], $(m.amountCents), null, null,
              [m.orderNumber ? `Pedido ${m.orderNumber}` : "", m.description ?? "", m.voidReason ? `Motivo: ${m.voidReason}` : ""].filter(Boolean).join("; "),
              MOVEMENT_STATUS_LABEL[m.status],
              $(m.status === "ACTIVE" ? m.revenueEffect * m.amountCents : 0),
              $(m.status === "ACTIVE" ? m.cashEffect * m.amountCents : 0),
            ]);
          }
          for (const c of s.cancellations) {
            rows.push([
              c.id, b.date, b.shift, b.register, b.responsible, c.channel.name, c.paymentMethod?.name ?? "", MOVEMENT_TYPE_LABEL.CANCELAMENTO,
              $(c.amountCents), null, null, `Pedido ${c.orderNumber}; ${c.reason}`, c.movementId ? "Venda cancelada" : "Informativo", $(0), $(0),
            ]);
          }
        }
        break;
      }
      case "cancelamentos": {
        headers = ["ID", "Data", "Turno", "Caixa", "Responsável", "Canal", "Forma de pagamento", "Pedido", "Valor", "Motivo", "Funcionário", "Data e hora", "Estava lançado como venda"];
        for (const s of sessions) {
          const b = base(s);
          for (const c of s.cancellations) {
            rows.push([
              c.id, b.date, b.shift, b.register, b.responsible, c.channel.name, c.paymentMethod?.name ?? "", c.orderNumber, $(c.amountCents),
              c.reason, c.employeeName, formatDateTimeBR(c.occurredAt), c.movementId ? "Sim" : "Não",
            ]);
          }
        }
        break;
      }
    }
  }

  const csv = toCsv(headers, rows);
  await audit(prisma, actor, {
    action: "export.csv",
    entity: params.dataset,
    sessionId: params.sessionId,
    newValue: { dataset: params.dataset, from: params.from, to: params.to, sessionId: params.sessionId, rows: rows.length },
  });
  return { filename: `caixa-${params.dataset}-${label}.csv`, csv, rows: rows.length };
}
