import "dotenv/config";
import { defineConfig } from "prisma/config";

// "prisma generate" (usado no build) não conecta ao banco e não precisa da URL.
// Comandos que conectam (migrate, seed) falham com erro de conexão claro se ela faltar.
const url = process.env.DATABASE_URL ?? "postgresql://sem-banco-configurado:5432/postgres";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: { url },
});
