import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { loginWithPassword, userFromToken } from "@/server/services/auth";
import { createUnit, grantUnitAccess, listAccessibleUnits, listGrantedAccess, revokeUnitAccess, switchUnit } from "@/server/services/units";
import { listUsers } from "@/server/services/admin";

let env: Env;
beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

async function login(email: string) {
  const r = await loginWithPassword(email, "Senha12345");
  if (!("token" in r) || !r.token) throw new Error("login falhou");
  return r.token as string;
}

describe("acesso a mais de uma unidade", () => {
  let unitId = "";

  it("admin cria unidade nova com cadastros; isenção é herdada", async () => {
    const r = await createUnit(env.admin, { name: "Filial Centro" });
    unitId = r.id;
    expect(r.billingPlan).toBe("EXEMPT");
    expect(await prisma.salesChannel.count({ where: { restaurantId: r.id } })).toBeGreaterThan(0);
    const units = await listAccessibleUnits(env.admin.userId);
    expect(units.map((u) => u.name)).toEqual([expect.any(String), "Filial Centro"]);
    expect(units[0].home).toBe(true);
  });

  it("unidade criada a partir de restaurante em teste começa em teste", async () => {
    await prisma.restaurant.update({ where: { id: env.restaurantId }, data: { billingPlan: "TRIAL" } });
    const r = await createUnit(env.admin, { name: "Filial Praia" });
    expect(r.billingPlan).toBe("TRIAL");
    expect(r.trialEndsAt).not.toBeNull();
    await prisma.restaurant.update({ where: { id: env.restaurantId }, data: { billingPlan: "EXEMPT" } });
  });

  it("operador e gerente não criam unidade", async () => {
    await expect(createUnit(env.manager, { name: "Outra" })).rejects.toThrow(/permissão/);
  });

  it("trocar de unidade muda o restaurante da sessão e isola os dados", async () => {
    const token = await login(env.admin.email);
    const before = await userFromToken(token);
    expect(before!.restaurantId).toBe(env.restaurantId);
    await switchUnit(before!, unitId);
    const after = await userFromToken(token);
    expect(after!.restaurantId).toBe(unitId);
    expect(after!.role).toBe("ADMIN");
    const users = await listUsers(after!);
    expect(users.map((u) => u.email)).not.toContain(env.operator.email);
    await switchUnit(after!, env.restaurantId);
    expect((await userFromToken(token))!.restaurantId).toBe(env.restaurantId);
  });

  it("não troca para unidade sem acesso", async () => {
    const token = await login(env.manager.email);
    const u = await userFromToken(token);
    await expect(switchUnit(u!, unitId)).rejects.toThrow(/não tem acesso/);
  });

  it("liberar acesso dá papel próprio na unidade; remover volta para a principal", async () => {
    const token = await login(env.manager.email);
    const mgr = (await userFromToken(token))!;
    const adminInUnit = { ...env.admin, restaurantId: unitId };
    await expect(grantUnitAccess(adminInUnit, { email: "ninguem@x.com", role: "OPERATOR" })).rejects.toThrow(/Não há login/);
    const m = await grantUnitAccess(adminInUnit, { email: env.manager.email, role: "OPERATOR" });
    await switchUnit(mgr, unitId);
    const inUnit = (await userFromToken(token))!;
    expect(inUnit.restaurantId).toBe(unitId);
    expect(inUnit.role).toBe("OPERATOR");
    expect((await listGrantedAccess(adminInUnit)).map((g) => g.user.email)).toContain(env.manager.email);

    await revokeUnitAccess(adminInUnit, m.id);
    const back = (await userFromToken(token))!;
    expect(back.restaurantId).toBe(env.restaurantId);
    expect(back.role).toBe("MANAGER");
  });

  it("não remove o próprio acesso nem libera para quem já é da unidade", async () => {
    const adminInUnit = { ...env.admin, restaurantId: unitId };
    const own = await prisma.membership.findFirstOrThrow({ where: { userId: env.admin.userId, restaurantId: unitId } });
    await expect(revokeUnitAccess(adminInUnit, own.id)).rejects.toThrow(/próprio acesso/);
    await expect(grantUnitAccess(env.admin, { email: env.operator.email, role: "OPERATOR" })).rejects.toThrow(/já é desta unidade/);
  });
});
