import { formatBRL } from "./money";
import {
  CancellationRow,
  Catalog,
  ConferenceLine,
  DivergenceSummary,
  GroupDivergence,
  KIND_LABEL,
  MatrixCell,
  MovementRow,
  PAYMENT_KINDS,
  PaymentKind,
  SessionSummary,
  ClosingStatus,
} from "./types";

export type CheckedValues = Record<string, number | null | undefined>;

const isActive = (x: { active?: boolean }) => x.active !== false;
const bySort = <T extends { sortOrder?: number; name: string }>(a: T, b: T) =>
  (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "pt-BR");

export function lineKey(parts: { kind: PaymentKind; paymentMethodId: string | null; ticketBrandId?: string | null; channelId?: string | null }): string {
  if (parts.kind === "CASH") return "cash";
  if (parts.kind === "TICKET") return `pm:${parts.paymentMethodId}:tb:${parts.ticketBrandId}`;
  if (parts.kind === "ONLINE") return `pm:${parts.paymentMethodId}:ch:${parts.channelId}`;
  return `pm:${parts.paymentMethodId}`;
}

/**
 * Monta as linhas de conferência de uma sessão.
 *
 * - Dinheiro: esperado = fundo + movimentos físicos (summary.cash.expectedCents).
 * - Cartão crédito, débito, PIX e outros: uma linha por forma.
 * - Tickets: uma linha por bandeira (decomposição do grupo).
 * - Online: uma linha por plataforma/canal (decomposição do grupo).
 *
 * As linhas de bandeira e de plataforma decompõem o grupo; nunca somam além dele.
 * A soma de systemCents de todas as linhas é sempre igual ao faturamento.
 */
export function buildConferenceLines(
  summary: SessionSummary,
  catalog: Catalog,
  checked: CheckedValues = {},
): { lines: ConferenceLine[]; issues: string[] } {
  const issues: string[] = [];
  const cellsFor = (pred: (c: MatrixCell) => boolean) =>
    summary.matrix.filter(pred).reduce((acc, c) => acc + c.netCents, 0);

  const used = {
    methods: new Set(summary.matrix.map((c) => c.paymentMethodId)),
    brandsByMethod: new Map<string, Set<string>>(),
    channelsByMethod: new Map<string, Set<string>>(),
  };
  for (const c of summary.matrix) {
    if (c.ticketBrandId) {
      const s = used.brandsByMethod.get(c.paymentMethodId) ?? new Set();
      s.add(c.ticketBrandId);
      used.brandsByMethod.set(c.paymentMethodId, s);
    }
    if (c.paymentKind === "ONLINE") {
      const s = used.channelsByMethod.get(c.paymentMethodId) ?? new Set();
      s.add(c.channelId);
      used.channelsByMethod.set(c.paymentMethodId, s);
    }
  }

  const methodsSorted = [...catalog.methods].sort(bySort);
  const brandsSorted = [...catalog.brands].sort(bySort);
  const channelsSorted = [...catalog.channels].sort(bySort);
  const lines: ConferenceLine[] = [];

  const push = (
    line: Omit<ConferenceLine, "checkedCents" | "differenceCents" | "required">,
  ) => {
    const raw = checked[line.key];
    const checkedCents = raw === undefined || raw === null ? null : raw;
    lines.push({
      ...line,
      checkedCents,
      differenceCents: checkedCents === null ? null : checkedCents - line.expectedCents,
      required: line.systemCents !== 0 || line.expectedCents !== 0,
    });
  };

  for (const kind of PAYMENT_KINDS) {
    const methods = methodsSorted.filter(
      (m) => m.kind === kind && (isActive(m) || used.methods.has(m.id)),
    );

    if (kind === "CASH") {
      const method = methods[0] ?? methodsSorted.find((m) => m.kind === "CASH");
      push({
        key: "cash",
        group: "CASH",
        paymentMethodId: method?.id ?? null,
        ticketBrandId: null,
        channelId: null,
        label: method?.name ?? KIND_LABEL.CASH,
        fullLabel: method?.name ?? KIND_LABEL.CASH,
        systemCents: summary.byKind.CASH.netCents,
        expectedCents: summary.cash.expectedCents,
      });
      continue;
    }

    for (const m of methods) {
      if (kind === "TICKET") {
        const brandIds = new Set<string>([
          ...brandsSorted.filter(isActive).map((b) => b.id),
          ...(used.brandsByMethod.get(m.id) ?? []),
        ]);
        for (const b of brandsSorted.filter((x) => brandIds.has(x.id))) {
          const system = cellsFor((c) => c.paymentMethodId === m.id && c.ticketBrandId === b.id);
          push({
            key: lineKey({ kind, paymentMethodId: m.id, ticketBrandId: b.id }),
            group: kind,
            paymentMethodId: m.id,
            ticketBrandId: b.id,
            channelId: null,
            label: b.name,
            fullLabel: `${m.name} / ${b.name}`,
            systemCents: system,
            expectedCents: system,
          });
        }
      } else if (kind === "ONLINE") {
        const channelIds = new Set<string>([
          ...channelsSorted.filter((c) => c.isPlatform && isActive(c)).map((c) => c.id),
          ...(used.channelsByMethod.get(m.id) ?? []),
        ]);
        for (const ch of channelsSorted.filter((x) => channelIds.has(x.id))) {
          const system = cellsFor((c) => c.paymentMethodId === m.id && c.channelId === ch.id);
          push({
            key: lineKey({ kind, paymentMethodId: m.id, channelId: ch.id }),
            group: kind,
            paymentMethodId: m.id,
            ticketBrandId: null,
            channelId: ch.id,
            label: ch.name,
            fullLabel: `${m.name} / ${ch.name}`,
            systemCents: system,
            expectedCents: system,
          });
        }
      } else {
        const system = cellsFor((c) => c.paymentMethodId === m.id);
        push({
          key: lineKey({ kind, paymentMethodId: m.id }),
          group: kind,
          paymentMethodId: m.id,
          ticketBrandId: null,
          channelId: null,
          label: m.name,
          fullLabel: m.name,
          systemCents: system,
          expectedCents: system,
        });
      }
    }
  }

  // Garantia estrutural: nada de faturamento fica sem linha de conferência
  const linesSum = lines.reduce((acc, l) => acc + l.systemCents, 0);
  if (linesSum !== summary.revenueCents) {
    issues.push(
      `Linhas de conferência somam ${formatBRL(linesSum)}, mas o faturamento é ${formatBRL(summary.revenueCents)}. ` +
        "Há lançamentos em forma de pagamento, bandeira ou canal que não existem no cadastro.",
    );
  }
  return { lines, issues };
}

/** Total dos cartões (crédito + débito) na conferência. */
export function cardsTotals(lines: ConferenceLine[]) {
  const cards = lines.filter((l) => l.group === "CREDIT" || l.group === "DEBIT");
  const system = cards.reduce((a, l) => a + l.systemCents, 0);
  const checkedAll = cards.every((l) => l.checkedCents !== null || !l.required);
  const checked = cards.reduce((a, l) => a + (l.checkedCents ?? 0), 0);
  const difference = cards.reduce((a, l) => a + (l.differenceCents ?? 0), 0);
  return { systemCents: system, checkedCents: checked, differenceCents: difference, complete: checkedAll };
}

export function summarizeDivergence(
  lines: ConferenceLine[],
  options: {
    toleranceCents: number;
    movements?: MovementRow[];
    cancellations?: CancellationRow[];
    floatCents?: number;
  },
): DivergenceSummary {
  const pendingKeys = lines.filter((l) => l.required && l.checkedCents === null).map((l) => l.key);

  let net = 0;
  let abs = 0;
  let neg = 0;
  let pos = 0;
  const origins: DivergenceSummary["origins"] = [];
  for (const l of lines) {
    if (l.differenceCents === null) continue;
    net += l.differenceCents;
    abs += Math.abs(l.differenceCents);
    if (l.differenceCents < 0) neg++;
    if (l.differenceCents > 0) pos++;
    if (l.differenceCents !== 0) {
      origins.push({ key: l.key, label: l.fullLabel, differenceCents: l.differenceCents });
    }
  }

  let status: ClosingStatus | null = null;
  if (pendingKeys.length === 0) {
    status = neg === 0 && pos === 0 ? "CORRETO" : neg > 0 && pos === 0 ? "FALTA" : pos > 0 && neg === 0 ? "SOBRA" : "MISTO";
  }

  const byGroup: GroupDivergence[] = [];
  for (const kind of PAYMENT_KINDS) {
    const g = lines.filter((l) => l.group === kind);
    if (g.length === 0) continue;
    byGroup.push({
      group: kind,
      label: KIND_LABEL[kind],
      systemCents: g.reduce((a, l) => a + l.systemCents, 0),
      expectedCents: g.reduce((a, l) => a + l.expectedCents, 0),
      checkedCents: g.reduce((a, l) => a + (l.checkedCents ?? 0), 0),
      differenceCents: g.reduce((a, l) => a + (l.differenceCents ?? 0), 0),
    });
  }

  return {
    netCents: net,
    absCents: abs,
    status,
    pendingKeys,
    toleranceCents: options.toleranceCents,
    requiresJustification: abs > options.toleranceCents,
    byGroup,
    origins,
    hints: explainDivergence(lines, options.movements ?? [], options.cancellations ?? [], options.floatCents ?? 0),
  };
}

const TYPE_LABEL: Record<string, string> = {
  VENDA: "venda",
  SUPRIMENTO: "suprimento",
  SANGRIA: "sangria",
  DESPESA: "despesa",
  ESTORNO: "estorno",
  AJUSTE: "ajuste",
};

/**
 * Pistas objetivas sobre a origem de cada diferença. Não adivinha: só aponta
 * coincidências exatas de valor com lançamentos do próprio turno.
 */
export function explainDivergence(
  lines: ConferenceLine[],
  movements: MovementRow[],
  cancellations: CancellationRow[],
  floatCents: number,
): string[] {
  const hints: string[] = [];
  const withDiff = lines.filter((l) => l.differenceCents !== null && l.differenceCents !== 0);
  const active = movements.filter((m) => m.status === "ACTIVE");

  const describe = (m: MovementRow) => {
    const extra = m.orderNumber ? ` pedido ${m.orderNumber}` : m.description ? ` (${m.description})` : "";
    return `${TYPE_LABEL[m.type] ?? m.type} de ${formatBRL(m.amountCents)}${extra}`;
  };

  for (const l of withDiff) {
    const d = l.differenceCents as number;
    const abs = Math.abs(d);
    const what = d < 0 ? "Falta" : "Sobra";
    const where = l.fullLabel;

    if (l.group === "CASH") {
      if (floatCents > 0 && abs === floatCents) {
        hints.push(
          `${what} de ${formatBRL(abs)} em ${where} é igual ao fundo de abertura. Confira se o fundo foi deixado na gaveta ou retirado junto com o dinheiro do turno.`,
        );
      }
      for (const m of active.filter((x) => x.cashEffect !== 0 && x.amountCents === abs)) {
        hints.push(`${what} de ${formatBRL(abs)} em ${where} é igual a uma ${describe(m)}. Confira se foi lançada em duplicidade ou se faltou lançar/retirar.`);
      }
      for (const m of active.filter((x) => x.cashEffect !== 0 && x.amountCents * 2 === abs)) {
        hints.push(`${what} de ${formatBRL(abs)} em ${where} é o dobro de uma ${describe(m)}. Pode ter sido contada ou lançada duas vezes.`);
      }
      for (const c of cancellations.filter((x) => x.paymentKind === "CASH" && x.amountCents === abs)) {
        hints.push(`${what} de ${formatBRL(abs)} em ${where} é igual ao pedido cancelado${c.orderNumber ? ` ${c.orderNumber}` : ""} pago em dinheiro. Confira se o dinheiro foi devolvido ao cliente.`);
      }
      continue;
    }

    const sameLine = (m: MovementRow) =>
      m.paymentMethodId === l.paymentMethodId &&
      (l.ticketBrandId ? m.ticketBrandId === l.ticketBrandId : true) &&
      (l.channelId ? m.channelId === l.channelId : true);
    for (const m of active.filter((x) => x.revenueEffect !== 0 && sameLine(x) && x.amountCents === abs)) {
      hints.push(`${what} de ${formatBRL(abs)} em ${where} é igual a uma ${describe(m)} da mesma linha. Confira se ela foi lançada em duplicidade ou não passou na máquina/plataforma.`);
    }
    for (const c of cancellations.filter((x) => x.paymentMethodId === l.paymentMethodId && x.amountCents === abs)) {
      hints.push(`${what} de ${formatBRL(abs)} em ${where} é igual ao pedido cancelado${c.orderNumber ? ` ${c.orderNumber}` : ""}. Confira se a máquina/plataforma também cancelou.`);
    }
  }

  // Falta em uma linha compensada por sobra em outra
  for (let i = 0; i < withDiff.length; i++) {
    for (let j = i + 1; j < withDiff.length; j++) {
      const a = withDiff[i].differenceCents as number;
      const b = withDiff[j].differenceCents as number;
      if (a + b === 0) {
        const [neg, pos] = a < 0 ? [withDiff[i], withDiff[j]] : [withDiff[j], withDiff[i]];
        hints.push(
          `A falta de ${formatBRL(Math.abs(neg.differenceCents as number))} em ${neg.fullLabel} é igual à sobra em ${pos.fullLabel}. Possível lançamento na forma de pagamento errada.`,
        );
      }
    }
  }

  return [...new Set(hints)].slice(0, 8);
}
