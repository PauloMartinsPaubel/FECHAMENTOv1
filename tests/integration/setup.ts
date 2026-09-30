import { prisma } from "@/server/db";
import { seedBase } from "@/server/seed";
import bcrypt from "bcryptjs";
import type { Actor } from "@/server/actor";

export const TABLES = [
  "email_logs", "closing_details", "closing_conferences", "adjustments", "cancellations", "cash_movements",
  "cash_closings", "cash_sessions", "auth_sessions", "audit_logs", "users", "settings", "ticket_brands",
  "payment_methods", "sales_channels", "shifts", "cash_registers", "roles", "restaurants",
];

export async function resetDatabase() {
  if (!process.env.DATABASE_URL?.includes("_test")) {
    throw new Error("Recusado: os testes de integração só rodam em banco terminado em _test.");
  }
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export async function bootstrap() {
  await resetDatabase();
  const { restaurantId } = await seedBase(prisma, {
    adminEmail: "admin@teste.local",
    adminPassword: "Senha12345",
    bcryptCost: 4,
  });
  const roles = await prisma.role.findMany();
  const role = (code: string) => roles.find((r) => r.code === code)!.id;
  const hash = await bcrypt.hash("Senha12345", 4);
  const mk = async (name: string, email: string, code: "OPERATOR" | "MANAGER" | "ADMIN") =>
    prisma.user.upsert({
      where: { email },
      update: {},
      create: { restaurantId, roleId: role(code), name, email, passwordHash: hash },
    });
  const [op, op2, mgr] = await Promise.all([
    mk("João Operador", "joao@teste.local", "OPERATOR"),
    mk("Maria Operadora", "maria@teste.local", "OPERATOR"),
    mk("Gabriela Gerente", "gabriela@teste.local", "MANAGER"),
  ]);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@teste.local" } });
  await prisma.user.update({ where: { id: admin.id }, data: { mustChangePassword: false } });

  const actorOf = (u: { id: string; name: string; email: string }, role: Actor["role"]): Actor => ({
    userId: u.id, name: u.name, email: u.email, role, restaurantId, ip: "127.0.0.1",
  });

  for (const n of [2, 3, 4, 5, 6, 7, 8, 9]) {
    await prisma.cashRegister.upsert({
      where: { restaurantId_name: { restaurantId, name: `Caixa ${n}` } },
      update: {},
      create: { restaurantId, name: `Caixa ${n}`, sortOrder: n },
    });
  }
  const [channels, methods, brands, registers, shifts] = await Promise.all([
    prisma.salesChannel.findMany(),
    prisma.paymentMethod.findMany(),
    prisma.ticketBrand.findMany(),
    prisma.cashRegister.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.shift.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const byName = <T extends { name: string }>(list: T[], name: string) => {
    const x = list.find((i) => i.name === name);
    if (!x) throw new Error(`Cadastro não encontrado: ${name}`);
    return x;
  };

  return {
    restaurantId,
    operator: actorOf(op, "OPERATOR"),
    operator2: actorOf(op2, "OPERATOR"),
    manager: actorOf(mgr, "MANAGER"),
    admin: actorOf(admin, "ADMIN"),
    ch: (name: string) => byName(channels, name).id,
    pm: (name: string) => byName(methods, name).id,
    brand: (name: string) => byName(brands, name).id,
    register: registers[0],
    registers,
    morning: shifts[0],
    evening: shifts[1],
  };
}
export type Env = Awaited<ReturnType<typeof bootstrap>>;
