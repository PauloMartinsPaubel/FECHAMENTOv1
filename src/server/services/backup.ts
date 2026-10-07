import { gunzipSync, gzipSync, strFromU8, strToU8 } from "fflate";
import { prisma } from "../db";
import { defaultFrom, emailProvider, sendMail } from "../email/provider";
import { opsRecipients, reportError } from "./monitoring";

/**
 * Tabelas da cópia, na ordem de restauração (quem é referenciado vem antes).
 * Ficam de fora as sessões de login (tokens) e os erros do monitoramento: não fazem falta numa restauração.
 */
export const BACKUP_TABLES = [
  "roles", "restaurants", "settings", "cash_registers", "shifts", "sales_channels", "payment_methods", "ticket_brands",
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

export async function createBackup(now = new Date()): Promise<{ file: Buffer; counts: Record<string, number> }> {
  const tables: Record<string, unknown[]> = {};
  const counts: Record<string, number> = {};
  for (const t of BACKUP_TABLES) {
    // row_to_json deixa o Postgres converter datas, json e números do jeito que a restauração espera
    const rows = await prisma.$queryRawUnsafe<{ r: unknown }[]>(`SELECT row_to_json(x) AS r FROM "${t}" x`);
    tables[t] = rows.map((row) => row.r);
    counts[t] = rows.length;
  }
  const data: BackupFile = { version: 1, createdAt: now.toISOString(), tables };
  return { file: Buffer.from(gzipSync(strToU8(JSON.stringify(data)), { level: 9 })), counts };
}

export function readBackup(file: Uint8Array): BackupFile {
  const data = JSON.parse(strFromU8(gunzipSync(file))) as BackupFile;
  if (data?.version !== 1 || typeof data.tables !== "object") throw new Error("Arquivo de cópia inválido.");
  return data;
}

/**
 * Restaura uma cópia num banco VAZIO (com as tabelas já criadas pelas migrações).
 * Recusa se já houver restaurante, para nunca misturar com dados existentes.
 */
export async function restoreBackup(file: Uint8Array): Promise<Record<string, number>> {
  const data = readBackup(file);
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
  if (!to.length || emailProvider() === "none") return { sent: false, reason: "Sem OPS_ALERT_EMAIL ou envio de e-mail configurado." };
  try {
    const { file, counts } = await createBackup(now);
    const day = now.toISOString().slice(0, 10);
    if (file.length > MAX_ATTACHMENT_BYTES) {
      await reportError({ message: `Cópia de segurança grande demais para e-mail (${(file.length / 1048576).toFixed(1)} MB). É hora de guardar as cópias em outro lugar.`, kind: "backup" }, now, send);
      return { sent: false, reason: "grande demais", bytes: file.length };
    }
    const lines = Object.entries(counts).map(([t, n]) => `${t}: ${n}`);
    await send({
      from: defaultFrom(null),
      to,
      subject: `[Fechamento de Caixa] Cópia de segurança ${day}`,
      text: `Cópia de segurança de todos os restaurantes, gerada em ${now.toISOString()}.\nGuarde este e-mail. O anexo contém dados de clientes e senhas cifradas: não repasse.\n\nRegistros por tabela:\n${lines.join("\n")}`,
      html: `<p>Cópia de segurança de todos os restaurantes, gerada em ${now.toISOString()}.</p><p>Guarde este e-mail. O anexo contém dados de clientes e senhas cifradas: não repasse.</p><pre>${lines.join("\n")}</pre>`,
      attachments: [{ filename: `fechamento-backup-${day}.json.gz`, content: file, contentType: "application/gzip" }],
    });
    return { sent: true, bytes: file.length, counts };
  } catch (err) {
    const e = err as Error;
    await reportError({ message: `Falha na cópia de segurança: ${e?.message ?? String(err)}`, stack: e?.stack, kind: "backup" }, now, send);
    return { sent: false, reason: e?.message ?? String(err) };
  }
}
