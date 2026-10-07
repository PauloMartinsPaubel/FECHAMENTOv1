/**
 * Restaura uma cópia de segurança (.json.gz recebida por e-mail) num banco VAZIO.
 * Uso: DATABASE_URL=... npx tsx scripts/restaurar-backup.ts caminho/fechamento-backup-AAAA-MM-DD.json.gz
 * Antes: crie as tabelas com "npm run db:deploy" no banco novo.
 */
import { readFileSync } from "node:fs";
import { restoreBackup } from "../src/server/services/backup";
import { prisma } from "../src/server/db";

const path = process.argv[2];
if (!path) {
  console.error("Informe o arquivo da cópia.");
  process.exit(1);
}
restoreBackup(readFileSync(path))
  .then((counts) => {
    console.log("Restaurado:", counts);
  })
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
