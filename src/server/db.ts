import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL não configurada.");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export const prisma: PrismaClient = globalForPrisma.prisma ?? createClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;

/** Cliente ou transação: os serviços aceitam qualquer um. */
export type Db = Pick<
  PrismaClient,
  | "user" | "role" | "authSession" | "restaurant" | "cashRegister" | "shift" | "salesChannel" | "paymentMethod"
  | "ticketBrand" | "cashSession" | "cashMovement" | "cancellation" | "closingConference" | "cashClosing"
  | "closingDetail" | "adjustment" | "auditLog" | "emailLog" | "setting" | "$queryRaw" | "$executeRaw"
>;
