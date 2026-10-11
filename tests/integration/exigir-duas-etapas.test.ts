import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { loginWithPassword, userFromToken } from "@/server/services/auth";
import { codeForStep, stepAt } from "@/server/security/totp";
import { adminResetTwoFactor, confirmTwoFactorSetup, setTwoFactorPolicy, startTwoFactorSetup, twoFactorPolicy } from "@/server/services/two-factor";

let env: Env;

async function turnOn(actor: Env["admin"]) {
  const s = await startTwoFactorSetup(actor);
  await confirmTwoFactorSetup(actor, codeForStep(s.secret, stepAt(new Date())));
}
async function sessionOf(email: string) {
  const r = await loginWithPassword(email, "Senha12345");
  return userFromToken(r.token);
}

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = "chave-de-teste-com-mais-de-16-letras";
  env = await bootstrap();
});
afterAll(async () => {
  delete process.env.TOTP_ENCRYPTION_KEY;
  await prisma.$disconnect();
});

describe("exigir verificação em duas etapas de administradores e gerentes", () => {
  it("quem liga a regra precisa ter a própria verificação ligada; gerente não pode ligar", async () => {
    await expect(setTwoFactorPolicy(env.admin, true)).rejects.toThrow(/Ligue a sua verificação/);
    await expect(setTwoFactorPolicy(env.manager, true)).rejects.toThrow();
    await turnOn(env.admin);
    await setTwoFactorPolicy(env.admin, true);
    const p = await twoFactorPolicy(env.restaurantId);
    expect(p.required).toBe(true);
    expect(p.pending).toEqual(["Gabriela Gerente"]);
    const log = await prisma.auditLog.findFirst({ where: { action: "settings.2fa_policy" } });
    expect(log?.newValue).toEqual({ requireTwoFactor: true });
  });

  it("gerente sem a verificação fica preso em ligar; operador segue normal", async () => {
    expect((await sessionOf(env.manager.email))?.mustSetupTwoFactor).toBe(true);
    expect((await sessionOf(env.operator.email))?.mustSetupTwoFactor).toBe(false);
    await turnOn(env.manager);
    expect((await twoFactorPolicy(env.restaurantId)).pending).toEqual([]);
  });

  it("vale pelo papel na unidade escolhida no seletor", async () => {
    const other = await prisma.restaurant.create({ data: { name: "Unidade 2", billingPlan: "EXEMPT" } });
    const managerRole = await prisma.role.findUniqueOrThrow({ where: { code: "MANAGER" } });
    await prisma.membership.create({ data: { userId: env.operator.userId, restaurantId: other.id, roleId: managerRole.id } });
    await prisma.setting.create({ data: { restaurantId: other.id, closingRecipients: [], requireTwoFactor: true } });
    const r = await loginWithPassword(env.operator.email, "Senha12345");
    expect((await userFromToken(r.token))?.mustSetupTwoFactor).toBe(false);
    await prisma.authSession.updateMany({ where: { userId: env.operator.userId }, data: { activeRestaurantId: other.id } });
    const there = await userFromToken(r.token);
    expect(there?.restaurantId).toBe(other.id);
    expect(there?.mustSetupTwoFactor).toBe(true);
  });

  it("administrador reinicia a verificação de quem perdeu o celular: a pessoa liga de novo no próximo acesso", async () => {
    await adminResetTwoFactor(env.admin, env.manager.userId);
    expect((await sessionOf(env.manager.email))?.mustSetupTwoFactor).toBe(true);
  });

  it("desligar a regra libera todo mundo", async () => {
    await setTwoFactorPolicy(env.admin, false);
    expect((await sessionOf(env.manager.email))?.mustSetupTwoFactor).toBe(false);
  });
});
