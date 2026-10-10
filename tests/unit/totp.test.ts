import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { base32Decode, base32Encode, codeForStep, decryptSecret, encryptSecret, hashRecoveryCode, newRecoveryCodes, newSecret, otpauthUrl, stepAt, verifyCode } from "@/server/security/totp";

beforeAll(() => { process.env.TOTP_ENCRYPTION_KEY = "chave-de-teste-com-mais-de-16"; });
afterAll(() => { delete process.env.TOTP_ENCRYPTION_KEY; });

describe("verificação em duas etapas (TOTP)", () => {
  it("bate com o vetor de teste oficial da RFC 6238", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(codeForStep(secret, stepAt(new Date(59_000)), 8)).toBe("94287082");
    expect(codeForStep(secret, stepAt(new Date(1111111109_000)), 8)).toBe("07081804");
    expect(codeForStep(secret, stepAt(new Date(2000000000_000)), 8)).toBe("69279037");
  });

  it("base32 vai e volta", () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 128, 7]);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });

  it("aceita o código atual e o vizinho, recusa repetido e errado", () => {
    const s = newSecret();
    const now = new Date("2026-10-12T12:00:15Z");
    const step = stepAt(now);
    expect(verifyCode(s, codeForStep(s, step), now, null)).toBe(step);
    expect(verifyCode(s, codeForStep(s, step - 1), now, null)).toBe(step - 1);
    expect(verifyCode(s, codeForStep(s, step - 2), now, null)).toBeNull();
    expect(verifyCode(s, codeForStep(s, step), now, step)).toBeNull();
    expect(verifyCode(s, "000000", now, null) === null || codeForStep(s, step) === "000000").toBe(true);
    expect(verifyCode(s, "12345", now, null)).toBeNull();
  });

  it("cifra e decifra o segredo; com outra chave não abre", () => {
    const enc = encryptSecret("ABCDEF234567");
    expect(enc.startsWith("k1:")).toBe(true);
    expect(enc).not.toContain("ABCDEF234567");
    expect(decryptSecret(enc)).toBe("ABCDEF234567");
    process.env.TOTP_ENCRYPTION_KEY = "outra-chave-qualquer-bem-longa";
    expect(decryptSecret(enc)).toBeNull();
    process.env.TOTP_ENCRYPTION_KEY = "chave-de-teste-com-mais-de-16";
  });

  it("códigos de recuperação únicos, hash ignora traço e caixa", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(hashRecoveryCode(codes[0].toLowerCase().replace("-", " "))).toBe(hashRecoveryCode(codes[0]));
  });

  it("endereço para o aplicativo", () => {
    expect(otpauthUrl("ABC", "ana@x.com")).toBe("otpauth://totp/Fechamento%20de%20Caixa%3Aana%40x.com?secret=ABC&issuer=Fechamento%20de%20Caixa&algorithm=SHA1&digits=6&period=30");
  });
});
