import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { addDays, todayIso, toDbDate } from "@/lib/dates";
import { CASH_DENOMINATIONS, type CashCount } from "@/lib/finance/cash-count";
import type { RoleCode } from "@/lib/permissions";
import { Actor, assertCan } from "../actor";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { loadSessionBundle } from "../loaders";
import { closeSession } from "./closing";
import { saveConference } from "./conference";
import { createMovement, createMovementsBatch, registerCancellation, type MovementInput } from "./movements";
import { openSession } from "./sessions";
import { createUnit, listAccessibleUnits } from "./units";

export const DEMO_UNIT_NAME = "Restaurante Demonstração";

/** Gerador pseudoaleatório com semente: a mesma semente gera sempre os mesmos dados. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Rand = () => number;
const pick = <T,>(r: Rand, items: readonly T[]) => items[Math.floor(r() * items.length)];
function weighted<T>(r: Rand, items: readonly [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let x = r() * total;
  for (const [v, w] of items) if ((x -= w) < 0) return v;
  return items[items.length - 1][0];
}
/** Valor de prato em centavos, terminado em ,00 ou ,90 como num cardápio. */
function ticket(r: Rand, min: number, max: number): number {
  const reais = Math.floor(min + (max - min) * Math.pow(r(), 1.6));
  return reais * 100 + (r() < 0.6 ? 90 : 0);
}

/** Separa um valor em notas e moedas, das maiores para as menores, como alguém contaria a gaveta. */
export function breakIntoDenominations(cents: number): CashCount {
  const out: CashCount = {};
  let rest = cents;
  for (const d of CASH_DENOMINATIONS) {
    if (d.cents === 20000) continue; // nota de 200 quase não aparece em caixa de restaurante
    const q = Math.floor(rest / d.cents);
    if (q > 0) {
      out[String(d.cents)] = q;
      rest -= q * d.cents;
    }
  }
  return out;
}

/** Hora local de São Paulo (UTC-3, sem horário de verão) para um instante UTC. */
const atLocal = (iso: string, hour: number, minute: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, hour + 3, minute));
};

const JUSTIFICATIONS = [
  "Troco dado a mais em um pedido do balcão.",
  "Venda no débito lançada como crédito; conferido no extrato da máquina.",
  "Moedas faltando na contagem; gerente avisado.",
  "Entregador pago com dinheiro do caixa e não lançado como despesa.",
  "Gorjeta deixada em dinheiro junto com o pagamento.",
];

interface DemoCatalog {
  ch: Record<string, string>;
  pm: Record<string, string>;
  brands: string[];
  registerId: string;
  shifts: { id: string; code: string }[];
}

async function catalogOf(restaurantId: string): Promise<DemoCatalog> {
  const [channels, methods, brands, registers, shifts] = await Promise.all([
    prisma.salesChannel.findMany({ where: { restaurantId } }),
    prisma.paymentMethod.findMany({ where: { restaurantId } }),
    prisma.ticketBrand.findMany({ where: { restaurantId } }),
    prisma.cashRegister.findMany({ where: { restaurantId }, orderBy: { sortOrder: "asc" } }),
    prisma.shift.findMany({ where: { restaurantId }, orderBy: { sortOrder: "asc" } }),
  ]);
  return {
    ch: Object.fromEntries(channels.map((c) => [c.name, c.id])),
    pm: Object.fromEntries(methods.map((m) => [m.kind, m.id])),
    brands: brands.filter((b) => b.name !== "Outros").map((b) => b.id),
    registerId: registers[0].id,
    shifts: shifts.map((s) => ({ id: s.id, code: s.code })),
  };
}

/** Uma venda com canal e forma de pagamento nas proporções de um restaurante comum. */
function sale(r: Rand, c: DemoCatalog, iso: string, hourFrom: number, hourTo: number, n: number): MovementInput {
  const minute = Math.floor(r() * (hourTo - hourFrom) * 60);
  const occurredAt = atLocal(iso, hourFrom + Math.floor(minute / 60), minute % 60);
  const kind = weighted(r, [["balcao", 62], ["ifood", 22], ["99food", 6], ["site", 4], ["telefone", 6]] as const);
  if (kind === "ifood" || kind === "99food" || kind === "site") {
    const channel = kind === "ifood" ? "iFood" : kind === "99food" ? "99Food" : "Site próprio";
    const prefix = kind === "ifood" ? "IF" : kind === "99food" ? "99" : "ST";
    return { type: "VENDA", amountCents: ticket(r, 32, 140), channelId: c.ch[channel], paymentMethodId: c.pm.ONLINE, orderNumber: `${prefix}-${4000 + n}`, occurredAt };
  }
  if (kind === "telefone") {
    return { type: "VENDA", amountCents: ticket(r, 35, 120), channelId: c.ch["Telefone/Tablet"], paymentMethodId: weighted(r, [[c.pm.CASH, 1], [c.pm.PIX, 2]]), occurredAt };
  }
  const method = weighted(r, [["CASH", 16], ["DEBIT", 22], ["CREDIT", 24], ["PIX", 26], ["TICKET", 12]] as const);
  return {
    type: "VENDA",
    amountCents: ticket(r, 22, 190),
    channelId: c.ch["Balcão"],
    paymentMethodId: c.pm[method],
    ticketBrandId: method === "TICKET" ? pick(r, c.brands) : null,
    occurredAt,
  };
}

/** Semente fixa por dia e turno: retomar uma geração interrompida produz os mesmos dados. */
function seedFor(iso: string, code: string, base: number): number {
  let h = base >>> 0;
  for (const ch of iso + code) h = (Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0);
  return h;
}

/**
 * Lança, confere e fecha um turno inteiro, usando as mesmas regras do sistema.
 * Se o turno já existe (geração interrompida), continua de onde parou; se já está fechado, não mexe.
 */
async function fillShift(base: number, c: DemoCatalog, opener: Actor, operator: Actor, iso: string, shift: { id: string; code: string }, close: boolean): Promise<"skip" | "done"> {
  const r = rng(seedFor(iso, shift.code, base));
  const lunch = shift.code === "MANHA";
  const weekday = new Date(`${iso}T12:00:00Z`).getUTCDay();
  const busy = weekday === 5 || weekday === 6 ? 1.35 : weekday === 1 ? 0.75 : 1;
  const existing = await prisma.cashSession.findUnique({
    where: { registerId_shiftId_businessDate: { registerId: c.registerId, shiftId: shift.id, businessDate: toDbDate(iso) } },
  });
  if (existing && existing.status !== "OPEN") return "skip";
  let sessionId = existing?.id;
  if (!sessionId) {
    const { session } = await openSession(opener, { registerId: c.registerId, shiftId: shift.id, businessDate: iso, openingFloatCents: 20000, floatMode: "NEW_OPENING" });
    sessionId = session.id;
    // quem trabalhou no caixa é a recepção, mesmo quando o caixa antigo foi aberto pelo gerente
    if (opener.userId !== operator.userId) await prisma.cashSession.update({ where: { id: sessionId }, data: { responsibleId: operator.userId } });
  }

  const hasSales = (await prisma.cashMovement.count({ where: { sessionId, type: "VENDA" } })) > 0;
  const [from, to] = lunch ? [11, 15] : [18, 23];
  if (!hasSales) {
    const count = close ? Math.round((lunch ? 26 : 34) * busy * (0.85 + r() * 0.3)) : 9;
    const sales = Array.from({ length: count }, (_, i) => sale(r, c, iso, from, to, Math.floor(r() * 5000) + i));
    if (!close) {
      for (const s of sales) await createMovement(operator, sessionId, s);
      return "done";
    }
    await createMovementsBatch(operator, sessionId, sales, `demo-${sessionId}`);

    // sangria e despesa só com o dinheiro que de fato entrou na gaveta
    const cashIn = sales.filter((x) => x.paymentMethodId === c.pm.CASH).reduce((t, x) => t + x.amountCents, 0);
    const extras: MovementInput[] = [];
    const withdrawal = !lunch && cashIn >= 15000 && r() < 0.7 ? Math.floor((cashIn * 0.6) / 5000) * 5000 : 0;
    if (withdrawal > 0) extras.push({ type: "SANGRIA", amountCents: withdrawal, description: "Retirada para o cofre", occurredAt: atLocal(iso, 21, 30) });
    const left = 20000 + cashIn - withdrawal;
    if (left > 5000 && r() < 0.35) {
      extras.push({ type: "DESPESA", amountCents: Math.min(ticket(r, 12, 60), left - 3000), paymentMethodId: c.pm.CASH, description: pick(r, ["Gelo", "Entregador avulso", "Pão extra", "Gás de cozinha (parte)"]), occurredAt: atLocal(iso, from + 1, 10) });
    }
    if (extras.length) await createMovementsBatch(operator, sessionId, extras, `demo-x-${sessionId}`);
    if (r() < 0.15) {
      await registerCancellation(operator, sessionId, {
        orderNumber: `IF-${7000 + Math.floor(r() * 2000)}`,
        channelId: c.ch.iFood,
        paymentMethodId: c.pm.ONLINE,
        amountCents: ticket(r, 30, 90),
        reason: pick(r, ["Cliente cancelou no aplicativo", "Item em falta", "Endereço fora da área"]),
        employeeName: operator.name,
      });
    }
  } else if (!close) {
    return "done";
  }

  const bundle = await loadSessionBundle(prisma, operator.restaurantId, sessionId);
  const values: Record<string, number | null> = {};
  for (const l of bundle.evaluation.lines) if (l.required) values[l.key] = Math.max(0, l.expectedCents);
  // de vez em quando a gaveta não bate, como na vida real
  const cash = values.cash;
  if (typeof cash === "number" && r() < 0.18) values.cash = Math.max(0, cash + (r() < 0.6 ? -1 : 1) * (200 + Math.floor(r() * 30) * 100 + (r() < 0.3 ? 50 : 0)));
  const cashCount = typeof values.cash === "number" ? breakIntoDenominations(values.cash) : null;
  await saveConference(operator, sessionId, values, null, cashCount);
  const after = await loadSessionBundle(prisma, operator.restaurantId, sessionId);
  await closeSession(operator, sessionId, {
    justification: after.evaluation.divergence.requiresJustification ? pick(r, JUSTIFICATIONS) : null,
  });
  // datas e horas como se cada caixa tivesse acontecido no próprio dia (só na demonstração)
  const closedAt = atLocal(iso, lunch ? 15 : 23, 10 + Math.floor(r() * 40));
  const closing = await prisma.cashClosing.findUniqueOrThrow({ where: { sessionId } });
  const snap = closing.snapshot as { session?: { closedAt?: string } } | null;
  if (snap?.session) snap.session.closedAt = closedAt.toISOString();
  await prisma.cashClosing.update({ where: { id: closing.id }, data: { closedAt, snapshot: snap as object } });
  await prisma.cashSession.update({ where: { id: sessionId }, data: { createdAt: atLocal(iso, from - 1, 45) } });
  await prisma.$executeRaw`UPDATE cash_movements SET "createdAt" = COALESCE("occurredAt", ${atLocal(iso, from, 0)}) WHERE "sessionId" = ${sessionId}`;
  return "done";
}

export const DEMO_DAYS = 42;

export interface DemoResult {
  restaurantId: string;
  closedSessions: number;
  days: number;
  resumed: boolean;
}

/** Situação da demonstração para quem está logado: não existe, existe incompleta (geração interrompida) ou pronta. */
export async function demoStatus(userId: string, days = DEMO_DAYS): Promise<"none" | "incomplete" | "ready"> {
  const unit = (await listAccessibleUnits(userId)).find((u) => u.name === DEMO_UNIT_NAME);
  if (!unit) return "none";
  const closed = await prisma.cashSession.count({ where: { restaurantId: unit.restaurantId, status: { in: ["CLOSED", "CORRECTED"] } } });
  return closed >= days * 2 ? "ready" : "incomplete";
}

const DEMO_PEOPLE = [["Ana Souza", "OPERATOR"], ["Bruno Lima", "OPERATOR"], ["Carla Mendes", "MANAGER"]] as const;

/**
 * Cria uma unidade "Restaurante Demonstração" com seis semanas de caixas fictícios (abertos, conferidos e fechados
 * pelas regras do sistema) e um caixa de hoje ainda aberto. Quem cria vira administrador dela e troca pelo seletor do topo.
 * Se uma geração anterior foi interrompida, continua de onde parou.
 * Só a conta isenta (a do dono do sistema) pode criar, para a demonstração não virar uma unidade gratuita de clientes.
 */
export async function createDemoUnit(actor: Actor, opts: { days?: number; now?: Date; seed?: number; stopAfter?: number } = {}): Promise<DemoResult> {
  assertCan(actor, "settings.manage");
  const home = await prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId }, select: { billingPlan: true, name: true } });
  if (home.billingPlan !== "EXEMPT" || home.name === DEMO_UNIT_NAME) throw new ServiceError("A demonstração só pode ser criada pela conta do dono do sistema.", "FORBIDDEN");
  const days = opts.days ?? DEMO_DAYS;
  const found = (await listAccessibleUnits(actor.userId)).find((u) => u.name === DEMO_UNIT_NAME);
  if (found && (await demoStatus(actor.userId, days)) === "ready") {
    throw new ServiceError("Você já tem a unidade de demonstração. Troque para ela no seletor do topo.", "CONFLICT");
  }

  const restaurantId = found ? found.restaurantId : (await createUnit(actor, { name: DEMO_UNIT_NAME })).id;
  if (!found) await prisma.setting.updateMany({ where: { restaurantId }, data: { toleranceCents: 500, defaultOpeningFloatCents: 20000 } });

  // pessoas fictícias: não entram no sistema (senha aleatória que ninguém conhece, e-mail que não existe)
  const roles = await prisma.role.findMany();
  const roleId = (code: RoleCode) => roles.find((x) => x.code === code)!.id;
  const suffix = restaurantId.slice(0, 8);
  const people = [];
  for (const [name, code] of DEMO_PEOPLE) {
    const email = `${name.split(" ")[0].toLowerCase()}.${suffix}@demonstracao.invalid`;
    const user =
      (await prisma.user.findUnique({ where: { email } })) ??
      (await prisma.user.create({
        data: { restaurantId, roleId: roleId(code), name, email, passwordHash: await bcrypt.hash(randomBytes(24).toString("hex"), 4), mustChangePassword: false },
      }));
    people.push({ userId: user.id, name: user.name, email: user.email, role: code as RoleCode, restaurantId, ip: null } satisfies Actor);
  }
  const [ana, bruno, carla] = people;

  const c = await catalogOf(restaurantId);
  const base = opts.seed ?? 20261008;
  const today = todayIso(opts.now);
  let closed = 0;
  for (let d = days; d >= 1; d--) {
    const iso = addDays(today, -d);
    for (const s of c.shifts) {
      // stopAfter só existe para os testes simularem uma geração interrompida
      if (opts.stopAfter !== undefined && closed >= opts.stopAfter) throw new Error("geração interrompida (teste)");
      await fillShift(base, c, carla, s.code === "MANHA" ? ana : bruno, iso, s, true);
      closed++;
    }
  }
  // hoje: o caixa da manhã aberto, com algumas vendas, para mostrar o lançamento ao vivo
  const morning = c.shifts.find((s) => s.code === "MANHA") ?? c.shifts[0];
  await fillShift(base, c, ana, ana, today, morning, false);
  return { restaurantId, closedSessions: closed, days, resumed: Boolean(found) };
}
