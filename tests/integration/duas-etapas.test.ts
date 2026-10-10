import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { loginWithPassword, userFromToken } from "@/server/services/auth";
import { codeForStep, decryptSecret, stepAt } from "@/server/security/totp";
import {
  adminResetTwoFactor,
  completeSecondStep,
  confirmTwoFactorSetup,
  disableTwoFactor,
  listMySessions,
  MAX_CODE_ATTEMPTS,
  pendingLogin,
  regenerateRecoveryCodes,
  revokeMySession,
  revokeOtherSessions,
  startTwoFactorSetup,
  twoFactorStatus,
} from "@/server/services/two-factor";

let env: Env;
const later = (s: number) => new Date(Date.now() + s * 1000);
async function secretOf(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  return decryptSecret((u.totpSecretEnc ?? u.totpPendingEnc)!)!;
}

beforeAll(async () => {
  process.env.TOTP_ENCRYPTION_KEY = "chave-de-teste-com-mais-de-16-letras";
  env = await bootstrap();
});
afterAll(async () => {
  delete process.env.TOTP_ENCRYPTION_KEY;
  await prisma.$disconnect();
});

describe("verificação em duas etapas", () => {
  let codes: string[] = [];

  it("liga com QR e código; segredo fica cifrado; códigos de recuperação saem uma vez", async () => {
    const s = await startTwoFactorSetup(env.manager);
    expect(s.qr.startsWith("data:image/svg+xml;base64,")).toBe(true);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: env.manager.userId } });
    expect(row.totpPendingEnc).not.toContain(s.secret);
    await expect(confirmTwoFactorSetup(env.manager, "000000".replace(/0/g, () => "1"))).rejects.toThrow(/não confere/);
    codes = await confirmTwoFactorSetup(env.manager, codeForStep(s.secret, stepAt(new Date())));
    expect(codes).toHaveLength(10);
    const st = await twoFactorStatus(env.manager.userId);
    expect(st.enabled).toBe(true);
    expect(st.recoveryLeft).toBe(10);
    await expect(startTwoFactorSetup(env.manager)).rejects.toThrow(/já está ligada/);
  });

  it("login: senha certa não dá acesso até o código; código certo libera e troca o token", async () => {
    const r = await loginWithPassword(env.manager.email, "Senha12345");
    expect(r.pendingTwoFactor).toBe(true);
    expect(await userFromToken(r.token)).toBeNull();
    expect((await pendingLogin(r.token))?.name).toBe(env.manager.name);
    const secret = await secretOf(env.manager.userId);
    const done = await completeSecondStep(r.token, codeForStep(secret, stepAt(later(30))), {}, later(30));
    expect(done.token).not.toBe(r.token);
    expect(await userFromToken(r.token)).toBeNull();
    expect((await userFromToken(done.token))?.userId).toBe(env.manager.userId);
  });

  it("o mesmo código não serve duas vezes; erros demais derrubam a etapa", async () => {
    const secret = await secretOf(env.manager.userId);
    const r = await loginWithPassword(env.manager.email, "Senha12345");
    await expect(completeSecondStep(r.token, codeForStep(secret, stepAt(later(30))), {}, later(30))).rejects.toThrow(/não confere/);
    for (let i = 1; i < MAX_CODE_ATTEMPTS; i++) await expect(completeSecondStep(r.token, "999999x", {}, later(30))).rejects.toThrow();
    expect(await pendingLogin(r.token)).toBeNull();
  });

  it("código de recuperação entra uma vez só", async () => {
    const r = await loginWithPassword(env.manager.email, "Senha12345");
    const done = await completeSecondStep(r.token, codes[0].toLowerCase(), {}, later(60));
    expect(done.recoveryLeft).toBe(9);
    const r2 = await loginWithPassword(env.manager.email, "Senha12345");
    await expect(completeSecondStep(r2.token, codes[0], {}, later(60))).rejects.toThrow(/não confere/);
  });

  it("gerar novos códigos exige o aplicativo; desligar exige senha e código", async () => {
    const secret = await secretOf(env.manager.userId);
    const fresh = await regenerateRecoveryCodes(env.manager, codeForStep(secret, stepAt(later(90))), later(90));
    expect(fresh).toHaveLength(10);
    await expect(disableTwoFactor(env.manager, "errada", fresh[0], later(120))).rejects.toThrow(/Senha incorreta/);
    await disableTwoFactor(env.manager, "Senha12345", fresh[0], later(120));
    expect((await twoFactorStatus(env.manager.userId)).enabled).toBe(false);
    expect((await loginWithPassword(env.manager.email, "Senha12345")).pendingTwoFactor).toBe(false);
  });

  it("administrador desliga a de outra pessoa e derruba as sessões dela", async () => {
    const s = await startTwoFactorSetup(env.operator);
    await confirmTwoFactorSetup(env.operator, codeForStep(s.secret, stepAt(new Date())));
    await expect(adminResetTwoFactor(env.manager, env.operator.userId)).rejects.toThrow(/permissão/);
    await adminResetTwoFactor(env.admin, env.operator.userId);
    expect((await twoFactorStatus(env.operator.userId)).enabled).toBe(false);
    expect(await prisma.authSession.count({ where: { userId: env.operator.userId } })).toBe(0);
  });
});

describe("aparelhos conectados", () => {
  it("lista, encerra um, encerra todos os outros; não encerra o próprio por aqui", async () => {
    await prisma.authSession.deleteMany({ where: { userId: env.operator2.userId } });
    const a = await loginWithPassword(env.operator2.email, "Senha12345", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit Safari/604.1", ip: "189.40.10.20" });
    const b = await loginWithPassword(env.operator2.email, "Senha12345", { userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/129.0 Safari/537.36" });
    const c = await loginWithPassword(env.operator2.email, "Senha12345");
    const me = (await userFromToken(a.token))!;
    const list = await listMySessions(me);
    expect(list).toHaveLength(3);
    const mine = list.find((x) => x.current)!;
    expect(mine.device).toBe("Safari no iPhone");
    expect(mine.ip).toBe("189.40.x.x");
    await expect(revokeMySession(me, me.sessionId)).rejects.toThrow(/Sair/);
    const other = list.find((x) => !x.current)!;
    await revokeMySession(me, other.id);
    expect(await revokeOtherSessions(me)).toBe(1);
    expect(await userFromToken(b.token)).toBeNull();
    expect(await userFromToken(c.token)).toBeNull();
    expect(await userFromToken(a.token)).not.toBeNull();
    // não encerra sessão de outra pessoa
    const x = await loginWithPassword(env.operator.email, "Senha12345");
    const xs = await prisma.authSession.findFirstOrThrow({ where: { userId: env.operator.userId } });
    await expect(revokeMySession(me, xs.id)).rejects.toThrow(/não encontrada/);
    expect(await userFromToken(x.token)).not.toBeNull();
  });
});
