import type { RoleCode } from "@/lib/permissions";
import { todayIso } from "@/lib/dates";
import { Actor, assertCan } from "../actor";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { seedRestaurantCatalog } from "../seed";
import { cleanName } from "./admin";
import { trialEndFrom } from "./billing";
import { parseRecipients } from "./email";

export interface UnitAccess {
  restaurantId: string;
  name: string;
  role: RoleCode;
  home: boolean;
}

/** Unidades que o usuário pode abrir: a principal e as que receberam acesso ativo. */
export async function listAccessibleUnits(userId: string): Promise<UnitAccess[]> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: {
      restaurant: { select: { id: true, name: true } },
      role: true,
      memberships: { where: { active: true }, include: { restaurant: { select: { id: true, name: true } }, role: true } },
    },
  });
  const units: UnitAccess[] = [
    { restaurantId: user.restaurant.id, name: user.restaurant.name, role: user.role.code as RoleCode, home: true },
    ...user.memberships
      .filter((m) => m.restaurantId !== user.restaurantId)
      .map((m) => ({ restaurantId: m.restaurant.id, name: m.restaurant.name, role: m.role.code as RoleCode, home: false })),
  ];
  return units.sort((a, b) => Number(b.home) - Number(a.home) || a.name.localeCompare(b.name, "pt-BR"));
}

/** Troca a unidade em uso nesta sessão de login. Só para unidades com acesso. */
export async function switchUnit(actor: Actor & { sessionId: string }, restaurantId: string) {
  const units = await listAccessibleUnits(actor.userId);
  const target = units.find((u) => u.restaurantId === restaurantId);
  if (!target) throw new ServiceError("Você não tem acesso a essa unidade.", "FORBIDDEN");
  await prisma.authSession.update({ where: { id: actor.sessionId }, data: { activeRestaurantId: target.home ? null : target.restaurantId } });
  await audit(prisma, { ...actor, restaurantId: target.restaurantId, role: target.role }, {
    action: "unit.switch",
    entity: "restaurant",
    entityId: target.restaurantId,
    newValue: { from: actor.restaurantId, to: target.restaurantId, unit: target.name },
  });
  return target;
}

/**
 * Cria outra unidade com os cadastros iniciais; quem criou vira administrador dela.
 * A cobrança é por unidade: se a unidade atual é isenta, a nova também é; senão, começa em teste grátis.
 */
export async function createUnit(actor: Actor, input: { name: string }) {
  assertCan(actor, "settings.manage");
  const name = cleanName(input.name, "O nome da unidade");
  const current = await prisma.restaurant.findUniqueOrThrow({ where: { id: actor.restaurantId }, select: { billingPlan: true } });
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  return prisma.$transaction(
    async (tx) => {
      const exempt = current.billingPlan === "EXEMPT";
      const r = await tx.restaurant.create({
        data: { name, billingPlan: exempt ? "EXEMPT" : "TRIAL", trialEndsAt: exempt ? null : trialEndFrom(todayIso()) },
      });
      await seedRestaurantCatalog(tx, r.id);
      await tx.membership.create({ data: { userId: actor.userId, restaurantId: r.id, roleId: adminRole.id, createdById: actor.userId } });
      await audit(tx, actor, { action: "unit.create", entity: "restaurant", entityId: r.id, newValue: { name, from: actor.restaurantId, billing: exempt ? "EXEMPT" : "TRIAL" } });
      await audit(tx, { ...actor, restaurantId: r.id, role: "ADMIN" }, { action: "unit.create", entity: "restaurant", entityId: r.id, newValue: { name, createdFrom: actor.restaurantId } });
      return r;
    },
    { timeout: 30_000 },
  );
}

/** Dá a alguém que já tem login (em outra unidade) acesso a esta unidade, com uma função. */
export async function grantUnitAccess(actor: Actor, input: { email: string; role: RoleCode }) {
  assertCan(actor, "users.manage");
  const [email] = parseRecipients(input.email);
  if (!email) throw new ServiceError("Informe o e-mail da pessoa.");
  if (!["ADMIN", "MANAGER", "OPERATOR"].includes(input.role)) throw new ServiceError("Função inválida.");
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.active) {
    throw new ServiceError("Não há login ativo com esse e-mail. Para alguém novo, cadastre em Novo usuário.");
  }
  if (user.restaurantId === actor.restaurantId) throw new ServiceError("Essa pessoa já é desta unidade. Mude a função na lista de usuários.");
  const role = await prisma.role.findUniqueOrThrow({ where: { code: input.role } });
  const m = await prisma.membership.upsert({
    where: { userId_restaurantId: { userId: user.id, restaurantId: actor.restaurantId } },
    update: { roleId: role.id, active: true },
    create: { userId: user.id, restaurantId: actor.restaurantId, roleId: role.id, createdById: actor.userId },
  });
  await audit(prisma, actor, { action: "unit.grant", entity: "membership", entityId: m.id, newValue: { email, role: input.role } });
  return m;
}

export async function revokeUnitAccess(actor: Actor, membershipId: string) {
  assertCan(actor, "users.manage");
  const m = await prisma.membership.findFirst({ where: { id: membershipId, restaurantId: actor.restaurantId }, include: { user: true, role: true } });
  if (!m) throw new ServiceError("Acesso não encontrado.", "NOT_FOUND");
  if (m.userId === actor.userId) throw new ServiceError("Você não pode tirar o próprio acesso.");
  if (m.role.code === "ADMIN") {
    const homeAdmins = await prisma.user.count({ where: { restaurantId: actor.restaurantId, active: true, role: { code: "ADMIN" } } });
    const otherAdmins = await prisma.membership.count({ where: { restaurantId: actor.restaurantId, active: true, role: { code: "ADMIN" }, id: { not: m.id } } });
    if (homeAdmins + otherAdmins === 0) throw new ServiceError("A unidade precisa de ao menos um administrador.");
  }
  await prisma.membership.update({ where: { id: m.id }, data: { active: false } });
  await audit(prisma, actor, { action: "unit.revoke", entity: "membership", entityId: m.id, oldValue: { email: m.user.email, role: m.role.code } });
}

/** Pessoas de outras unidades com acesso a esta. */
export async function listGrantedAccess(actor: Actor) {
  assertCan(actor, "users.manage");
  return prisma.membership.findMany({
    where: { restaurantId: actor.restaurantId, active: true },
    include: { user: { select: { name: true, email: true, active: true, restaurant: { select: { name: true } } } }, role: true },
    orderBy: { createdAt: "asc" },
  });
}
