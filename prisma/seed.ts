import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seedBase } from "../src/server/seed";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) throw new Error("Defina SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD.");
    if (password.length < 8) throw new Error("SEED_ADMIN_PASSWORD precisa ter ao menos 8 caracteres.");
    const { restaurantId } = await seedBase(prisma, { adminEmail: email, adminPassword: password });
    console.log(`Cadastros básicos prontos (restaurante ${restaurantId}). Administrador: ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
