import bcrypt from "bcryptjs";
import type { PrismaClient } from "@/generated/prisma/client";

export const BCRYPT_COST = 12;

export interface SeedOptions {
  restaurantName?: string;
  adminName?: string;
  adminEmail: string;
  adminPassword: string;
  /** testes usam custo menor para rodar rápido */
  bcryptCost?: number;
}

const SHIFTS = [
  { code: "MANHA", name: "Manhã", startTime: "06:00", endTime: "15:00", sortOrder: 1 },
  { code: "TARDE_NOITE", name: "Tarde/Noite", startTime: "15:00", endTime: "23:59", sortOrder: 2 },
];

// Canais são independentes: 99Food NÃO está dentro da Eclética.
const CHANNELS = [
  { name: "Balcão", isPlatform: false },
  { name: "iFood", isPlatform: true },
  { name: "99Food", isPlatform: true },
  { name: "Telefone/Tablet", isPlatform: false },
  { name: "Site próprio", isPlatform: true },
  { name: "Catálogo", isPlatform: false },
  { name: "Eclética", isPlatform: false },
  { name: "Outros", isPlatform: false },
];

const METHODS = [
  { name: "Dinheiro", kind: "CASH" as const },
  { name: "Cartão de crédito", kind: "CREDIT" as const },
  { name: "Cartão de débito", kind: "DEBIT" as const },
  { name: "PIX", kind: "PIX" as const },
  { name: "Tickets / Vales", kind: "TICKET" as const },
  { name: "Pagamento online", kind: "ONLINE" as const },
  { name: "Outros", kind: "OTHER" as const },
];

const BRANDS = ["Alelo", "Ticket Restaurante", "VR", "Sodexo/Pluxee", "Ben", "Outros"];

/** Cadastros básicos. Pode rodar mais de uma vez: só cria o que falta e nunca sobrescreve o que o admin mudou. */
export async function seedBase(prisma: PrismaClient, options: SeedOptions) {
  const roles = [
    { code: "ADMIN" as const, name: "Administrador", description: "Tudo: usuários, cadastros, configurações e auditoria" },
    { code: "MANAGER" as const, name: "Gerente", description: "Relatórios, conferência, reabertura e correção de fechamentos, CSV" },
    { code: "OPERATOR" as const, name: "Operador", description: "Abre caixa, lança valores, confere e fecha" },
  ];
  for (const r of roles) {
    await prisma.role.upsert({ where: { code: r.code }, update: {}, create: r });
  }

  let restaurant = await prisma.restaurant.findFirst({ orderBy: { createdAt: "asc" } });
  if (!restaurant) {
    restaurant = await prisma.restaurant.create({ data: { name: options.restaurantName ?? "Restaurante" } });
  }
  const restaurantId = restaurant.id;

  for (const s of SHIFTS) {
    await prisma.shift.upsert({
      where: { restaurantId_code: { restaurantId, code: s.code } },
      update: {},
      create: { restaurantId, ...s },
    });
  }

  if ((await prisma.cashRegister.count({ where: { restaurantId } })) === 0) {
    await prisma.cashRegister.create({ data: { restaurantId, name: "Caixa 1", sortOrder: 1 } });
  }

  let order = 0;
  for (const c of CHANNELS) {
    order++;
    await prisma.salesChannel.upsert({
      where: { restaurantId_name: { restaurantId, name: c.name } },
      update: {},
      create: { restaurantId, sortOrder: order, ...c },
    });
  }
  order = 0;
  for (const m of METHODS) {
    order++;
    const existing = await prisma.paymentMethod.findUnique({ where: { restaurantId_name: { restaurantId, name: m.name } } });
    if (!existing && (m.kind !== "CASH" || (await prisma.paymentMethod.count({ where: { restaurantId, kind: "CASH" } })) === 0)) {
      await prisma.paymentMethod.create({ data: { restaurantId, sortOrder: order, ...m } });
    }
  }
  order = 0;
  for (const name of BRANDS) {
    order++;
    await prisma.ticketBrand.upsert({
      where: { restaurantId_name: { restaurantId, name } },
      update: {},
      create: { restaurantId, name, sortOrder: order },
    });
  }

  await prisma.setting.upsert({
    where: { restaurantId },
    update: {},
    create: { restaurantId, defaultOpeningFloatCents: 10000, toleranceCents: 0, closingRecipients: [] },
  });

  const email = options.adminEmail.trim().toLowerCase();
  const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
  const existingAdmin = await prisma.user.findUnique({ where: { email } });
  if (!existingAdmin) {
    await prisma.user.create({
      data: {
        restaurantId,
        roleId: adminRole.id,
        name: options.adminName ?? "Administrador",
        email,
        passwordHash: await bcrypt.hash(options.adminPassword, options.bcryptCost ?? BCRYPT_COST),
        mustChangePassword: true,
      },
    });
  }

  return { restaurantId };
}
