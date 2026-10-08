import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { loginWithPassword, userFromToken } from "@/server/services/auth";
import { buildResetEmail, createPasswordReset, MAX_RESETS_PER_HOUR, resetPasswordWithToken, resetTokenIsValid, sendPasswordResetEmail } from "@/server/services/password-reset";
import type { MailMessage } from "@/server/email/provider";

let env: Env;
const tokenOf = (link: string) => decodeURIComponent(new URL(link).searchParams.get("t")!);
beforeAll(async () => { env = await bootstrap(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("esqueci minha senha", () => {
  it("e-mail desconhecido ou usuário desativado não gera link (e não dá erro)", async () => {
    expect(await createPasswordReset("ninguem@x.com", "https://app")).toBeNull();
    await prisma.user.update({ where: { id: env.operator2.userId }, data: { active: false } });
    expect(await createPasswordReset(env.operator2.email, "https://app")).toBeNull();
    await prisma.user.update({ where: { id: env.operator2.userId }, data: { active: true } });
  });

  it("gera link de uso único que troca a senha, encerra as sessões e desbloqueia", async () => {
    const old = await loginWithPassword(env.operator.email, "Senha12345");
    await prisma.user.update({ where: { id: env.operator.userId }, data: { failedLogins: 3, lockedUntil: new Date(Date.now() + 600_000) } });
    const r = (await createPasswordReset(` ${env.operator.email.toUpperCase()} `, "https://app.exemplo/"))!;
    expect(r.to).toBe(env.operator.email);
    expect(r.link.startsWith("https://app.exemplo/senha/nova?t=")).toBe(true);
    const token = tokenOf(r.link);
    expect(await resetTokenIsValid(token)).toBe(true);

    await expect(resetPasswordWithToken(token, "curta", "curta", { bcryptCost: 4 })).rejects.toThrow(/8 caracteres/);
    await expect(resetPasswordWithToken(token, "NovaSenha1", "Outra1234", { bcryptCost: 4 })).rejects.toThrow(/confirmação/);
    await resetPasswordWithToken(token, "NovaSenha1", "NovaSenha1", { bcryptCost: 4 });

    expect(await userFromToken(old.token)).toBeNull();
    await expect(loginWithPassword(env.operator.email, "Senha12345")).rejects.toThrow();
    const ok = await loginWithPassword(env.operator.email, "NovaSenha1");
    expect(ok.mustChangePassword).toBe(false);
    await expect(resetPasswordWithToken(token, "Outra12345", "Outra12345", { bcryptCost: 4 })).rejects.toThrow(/não vale mais/);
  });

  it("link expira e pedir um novo invalida os anteriores ao usar", async () => {
    const t0 = new Date();
    const a = (await createPasswordReset(env.manager.email, "https://app", {}, t0))!;
    const b = (await createPasswordReset(env.manager.email, "https://app", {}, t0))!;
    expect(await resetTokenIsValid(tokenOf(a.link), new Date(t0.getTime() + 31 * 60_000))).toBe(false);
    await resetPasswordWithToken(tokenOf(b.link), "Gerente123", "Gerente123", { bcryptCost: 4 });
    expect(await resetTokenIsValid(tokenOf(a.link))).toBe(false);
  });

  it("limita pedidos por hora", async () => {
    const t0 = new Date(Date.now() + 5 * 3600_000);
    for (let i = 0; i < MAX_RESETS_PER_HOUR; i++) expect(await createPasswordReset(env.admin.email, "https://app", {}, t0)).not.toBeNull();
    expect(await createPasswordReset(env.admin.email, "https://app", {}, t0)).toBeNull();
  });

  it("e-mail com o link; falha no envio não derruba", async () => {
    const sent: MailMessage[] = [];
    const r = { to: "x@y.com", name: "Ana <b>", link: "https://app/senha/nova?t=abc" };
    await sendPasswordResetEmail(r, async (m) => { sent.push(m); return { messageId: "1" }; });
    expect(sent[0].to).toEqual(["x@y.com"]);
    expect(sent[0].text).toContain("https://app/senha/nova?t=abc");
    expect(buildResetEmail(r).html).toContain("Ana &lt;b&gt;");
    await expect(sendPasswordResetEmail(r, async () => { throw new Error("smtp"); })).resolves.toBeUndefined();
  });
});
