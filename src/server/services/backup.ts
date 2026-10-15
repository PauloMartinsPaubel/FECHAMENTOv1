import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { prisma } from "../db";
import { defaultFrom, emailProvider, sendMail } from "../email/provider";
import { opsRecipients, reportError } from "./monitoring";
import { purgeOldHits } from "./rate-limit";

/**
 * Tabelas da cópia, na ordem de restauração (quem é referenciado vem antes).
 * Ficam de fora as sessões de login e os links de troca de senha (tokens), os erros do monitoramento, as visitas da página de apresentação
 * e o registro de tentativas: não fazem falta numa restauração.
 */
export const BACKUP_TABLES = [
  "roles", "restaurants", "settings", "cash_registers", "shifts", "sales_channels", "payment_methods", "ticket_brands", "stores",
  "users", "memberships", "cash_sessions", "cash_movements", "cancellations", "adjustments", "closing_conferences",
  "cash_closings", "closing_details", "email_logs", "audit_logs", "platform_integrations", "platform_orders",
  "platform_events", "billing_payments",
] as const;

/** Limite seguro para anexo no Gmail (25 MB) depois da codificação do e-mail. */
export const MAX_ATTACHMENT_BYTES = 18 * 1024 * 1024;

export interface BackupFile {
  version: 1;
  createdAt: string;
  tables: Record<string, unknown[]>;
}

// ---------------------------------------------------------------------------
// Cifra opcional do arquivo (BACKUP_ENCRYPTION_KEY)
// ---------------------------------------------------------------------------

/** Começo de todo arquivo cifrado: identifica o formato antes de tentar abrir. */
const MAGIC = Buffer.from("FCBK1");
const MIN_KEY_LENGTH = 16;

/** Chave para cifrar a cópia; sem ela a cópia sai só compactada, como antes. */
export function backupKey(): string | null {
  const k = process.env.BACKUP_ENCRYPTION_KEY;
  return k && k.length >= MIN_KEY_LENGTH ? k : null;
}

export function isEncryptedBackup(file: Uint8Array): boolean {
  return Buffer.from(file.subarray(0, MAGIC.length)).equals(MAGIC);
}

/** AES-256-GCM com chave derivada da frase por scrypt (sal novo a cada arquivo). */
export function encryptBackup(gz: Uint8Array, passphrase: string): Buffer {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(gz), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), body]);
}

export function decryptBackup(file: Uint8Array, passphrase: string): Buffer {
  const buf = Buffer.from(file);
  let at = MAGIC.length;
  const salt = buf.subarray(at, (at += 16));
  const iv = buf.subarray(at, (at += 12));
  const tag = buf.subarray(at, (at += 16));
  const decipher = createDecipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(buf.subarray(at)), decipher.final()]);
  } catch {
    throw new Error("Não foi possível abrir a cópia: a chave não confere ou o arquivo está danificado.");
  }
}

export async function createBackup(now = new Date(), passphrase: string | null = backupKey()): Promise<{ file: Buffer; counts: Record<string, number>; encrypted: boolean }> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    // row_to_json deixa o Postgres converter datas, json e números do jeito que a restauração espera
    const rows = await prisma.$queryRawUnsafe<{ r: unknown }[]>(`SELECT row_to_json(x) AS r FROM "${t}" x`);
    tables[t] = rows.map((row) => row.r);
    counts[t] = rows.length;
  }
  const data: BackupFile = { version: 1, createdAt: now.toISOString(), tables };
  const gz = gzipSync(strToU8(JSON.stringify(data)), { level: 9 });
  return { file: passphrase ? encryptBackup(gz, passphrase) : Buffer.from(gz), counts, encrypted: Boolean(passphrase) };
}

export function readBackup(file: Uint8Array, passphrase: string | null = backupKey()): BackupFile {
  if (isEncryptedBackup(file)) {
    if (!passphrase) throw new Error("Esta cópia está cifrada. Informe a chave em BACKUP_ENCRYPTION_KEY para restaurar.");
    file = decryptBackup(file, passphrase);
  }
  const data = JSON.parse(strFromU8(gunzipSync(file))) as BackupFile;
  if (data?.version !== 1 || typeof data.tables !== "object") throw new Error("Arquivo de cópia inválido.");
  return data;
}

/**
 * Restaura uma cópia num banco VAZIO (com as tabelas já criadas pelas migrações).
 * Recusa se já houver restaurante, para nunca misturar com dados existentes.
 */
export async function restoreBackup(file: Uint8Array, passphrase: string | null = backupKey()): Promise<Record<string, number>> {
  const data = readBackup(file, passphrase);
  const existing = await prisma.restaurant.count();
  if (existing > 0) throw new Error("O banco de destino já tem dados. A restauração só é feita em banco vazio.");
  const counts: Record<string, number> = {};
  await prisma.$transaction(
    async (tx) => {
      for (const t of BACKUP_TABLES) {
        const rows = data.tables[t] ?? [];
        counts[t] = rows.length;
        for (let i = 0; i < rows.length; i += 500) {
          const chunk = JSON.stringify(rows.slice(i, i + 500));
          await tx.$executeRawUnsafe(`INSERT INTO "${t}" SELECT * FROM json_populate_recordset(NULL::"${t}", $1::json)`, chunk);
        }
      }
    },
    { timeout: 300_000 },
  );
  return counts;
}

/** Rotina da madrugada: gera a cópia e manda por e-mail para o suporte. */
export async function runNightlyBackup(now = new Date(), send = sendMail) {
  const to = opsRecipients();
  await purgeOldHits(now).catch(() => 0);
  if (!to.length || emailProvider() === "none") return { sent: false, reason: "Sem OPS_ALERT_EMAIL ou envio de e-mail configurado." };
  try {
    const { file, counts, encrypted } = await createBackup(now);
    const day = now.toISOString().slice(0, 10);
    if (file.length > MAX_ATTACHMENT_BYTES) {
      await reportError({ message: `Cópia de segurança grande demais para e-mail (${(file.length / 1048576).toFixed(1)} MB). É hora de guardar as cópias em outro lugar.`, kind: "backup" }, now, send);
      return { sent: false, reason: "grande demais", bytes: file.length };
    }
    const lines = Object.entries(counts).map(([t, n]) => `${t}: ${n}`);
    const note = encrypted
      ? "O anexo está cifrado. Para restaurar é preciso a chave BACKUP_ENCRYPTION_KEY, guardada fora do e-mail."
      : "Guarde este e-mail. O anexo contém dados de clientes e senhas cifradas: não repasse. Para cifrar o anexo, configure BACKUP_ENCRYPTION_KEY no servidor.";
    await send({
      from: defaultFrom(null),
      to,
      subject: `[Fechamento de Caixa] Cópia de segurança ${day}`,
      text: `Cópia de segurança de todos os restaurantes, gerada em ${now.toISOString()}.\n${note}\n\nRegistros por tabela:\n${lines.join("\n")}`,
      html: `<p>Cópia de segurança de todos os restaurantes, gerada em ${now.toISOString()}.</p><p>${note}</p><pre>${lines.join("\n")}</pre>`,
      attachments: [
        encrypted
          ? { filename: `fechamento-backup-${day}.json.gz.cifrado`, content: file, contentType: "application/octet-stream" }
          : { filename: `fechamento-backup-${day}.json.gz`, content: file, contentType: "application/gzip" },
      ],
    });
    return { sent: true, bytes: file.length, counts, encrypted };
  } catch (err) {
    const e = err as Error;
    await reportError({ message: `Falha na cópia de segurança: ${e?.message ?? String(err)}`, stack: e?.stack, kind: "backup" }, now, send);
    return { sent: false, reason: e?.message ?? String(err) };
  }
}
