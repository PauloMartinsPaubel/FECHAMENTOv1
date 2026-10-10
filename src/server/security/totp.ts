import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Códigos de 6 dígitos que mudam a cada 30 segundos (RFC 6238), os mesmos do Google Authenticator. */
export const STEP_SECONDS = 30;
export const DIGITS = 6;

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function newSecret(): string {
  return base32Encode(randomBytes(20));
}

export function stepAt(time: Date): number {
  return Math.floor(time.getTime() / 1000 / STEP_SECONDS);
}

/** Código de um intervalo (HOTP sobre o número do intervalo). */
export function codeForStep(secretBase32: string, step: number, digits = DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const bin = ((mac[offset] & 127) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** digits).padStart(digits, "0");
}

/**
 * Confere um código aceitando um intervalo antes e um depois (relógio do celular um pouco adiantado ou atrasado).
 * Devolve o intervalo aceito, para o mesmo código não servir de novo; null se não confere.
 */
export function verifyCode(secretBase32: string, code: string, now: Date, lastStep: number | null): number | null {
  const clean = code.replace(/\D/g, "");
  if (clean.length !== DIGITS) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (lastStep !== null && step <= lastStep) continue;
    const expected = Buffer.from(codeForStep(secretBase32, step));
    if (timingSafeEqual(expected, Buffer.from(clean))) return step;
  }
  return null;
}

/** Endereço que o aplicativo lê pelo QR code. */
export function otpauthUrl(secretBase32: string, account: string, issuer = "Fechamento de Caixa"): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secretBase32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}

// ---------------------------------------------------------------------------
// Cifragem do segredo no banco (AES-256-GCM). A chave vem de TOTP_ENCRYPTION_KEY; sem ela, de CRON_SECRET.
// O prefixo diz qual chave foi usada, para dar para trocar de chave sem perder o que já foi cifrado.
// ---------------------------------------------------------------------------

function keyFor(kind: "k" | "c"): Buffer | null {
  const raw = kind === "k" ? process.env.TOTP_ENCRYPTION_KEY : process.env.CRON_SECRET;
  if (!raw || raw.trim().length < 16) return null;
  return createHash("sha256").update(`totp:${raw.trim()}`).digest();
}

export function encryptionAvailable(): boolean {
  return keyFor("k") !== null || keyFor("c") !== null;
}

export function encryptSecret(plain: string): string {
  const kind = keyFor("k") ? "k" : "c";
  const key = keyFor(kind);
  if (!key) throw new Error("Chave de cifragem não configurada (TOTP_ENCRYPTION_KEY ou CRON_SECRET).");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `${kind}1:${iv.toString("base64url")}:${c.getAuthTag().toString("base64url")}:${enc.toString("base64url")}`;
}

export function decryptSecret(stored: string): string | null {
  const [tag, ivB, authB, encB] = stored.split(":");
  const kind = tag?.[0] as "k" | "c";
  const key = kind === "k" || kind === "c" ? keyFor(kind) : null;
  if (!key || !ivB || !authB || !encB) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ivB, "base64url"));
    d.setAuthTag(Buffer.from(authB, "base64url"));
    return Buffer.concat([d.update(Buffer.from(encB, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Códigos de recuperação: para quando o celular some. Cada um vale uma vez; no banco, só o hash.
// ---------------------------------------------------------------------------

const RC_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function newRecoveryCodes(n = 10): string[] {
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const s = Array.from(b, (x) => RC_ALPHABET[x % RC_ALPHABET.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4)}`;
  });
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(`rc:${code.toUpperCase().replace(/[^A-Z0-9]/g, "")}`).digest("hex");
}
