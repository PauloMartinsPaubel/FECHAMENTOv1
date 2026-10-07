import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { registerRestaurant, signupOpen } from "@/server/services/signup";
import { loginWithPassword } from "@/server/services/auth";
import { openSession } from "@/server/services/sessions";
import { listClosings } from "@/server/services/queries";

let env: Env;
const base = { inviteCode: "convite-123", restaurantName: "Cantina Nova", adminName: "Maria Dona", email: "maria@cantina.com", password: "Senha1234", passwordConfirm: "Senha1234" };

beforeAll(async () => {
  env = await bootstrap();
  process.env.SIGNUP_CODE = "convite-123";
});
afterAll(async () => {
  delete process.env.SIGNUP_CODE;
  await prisma.$disconnect();
});

describe("cadastro de restaurante novo", () => {
  it("fechado sem SIGNUP_CODE; código errado é recusado", async () => {
    delete process.env.SIGNUP_CODE;
    expect(signupOpen()).toBe(false);
    await expect(registerRestaurant(base, { bcryptCost: 4 })).rejects.toThrow(/fechado/);
    process.env.SIGNUP_CODE = "convite-123";
    await expect(registerRestaurant({ ...base, inviteCode: "outro" }, { bcryptCost: 4 })).rejects.toThrow(/Código de convite inválido/);
  });

  it("valida nome, e-mail, senha e confirmação", async () => {
    await expect(registerRestaurant({ ...base, restaurantName: "X" }, { bcryptCost: 4 })).rejects.toThrow(/nome do restaurante/);
    await expect(registerRestaurant({ ...base, email: "nao-e-email" }, { bcryptCost: 4 })).rejects.toThrow(/E-mail inválido/);
    await expect(registerRestaurant({ ...base, password: "curta", passwordConfirm: "curta" }, { bcryptCost: 4 })).rejects.toThrow(/8 caracteres/);
    await expect(registerRestaurant({ ...base, passwordConfirm: "Senha9999" }, { bcryptCost: 4 })).rejects.toThrow(/confirmação/);
    await expect(registerRestaurant({ ...base, email: env.admin.email }, { bcryptCost: 4 })).rejects.toThrow(/já tem conta/);
  });

  it("cria restaurante com cadastros iniciais e administrador que já consegue entrar", async () => {
    const r = await registerRestaurant(base, { bcryptCost: 4 });
    const [shifts, registers, channels, methods, brands, settings] = await Promise.all([
      prisma.shift.count({ where: { restaurantId: r.restaurantId } }),
      prisma.cashRegister.count({ where: { restaurantId: r.restaurantId } }),
      prisma.salesChannel.count({ where: { restaurantId: r.restaurantId } }),
      prisma.paymentMethod.findMany({ where: { restaurantId: r.restaurantId } }),
      prisma.ticketBrand.count({ where: { restaurantId: r.restaurantId } }),
      prisma.setting.findUniqueOrThrow({ where: { restaurantId: r.restaurantId } }),
    ]);
    expect(shifts).toBe(2);
    expect(registers).toBe(1);
    expect(channels).toBeGreaterThanOrEqual(8);
    expect(methods.filter((m) => m.kind === "CASH")).toHaveLength(1);
    expect(brands).toBeGreaterThan(0);
    expect(settings.defaultOpeningFloatCents).toBe(10000);
    const login = await loginWithPassword("MARIA@cantina.com", "Senha1234");
    expect(login.token).toBeTruthy();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "maria@cantina.com" }, include: { role: true } });
    expect(user).toMatchObject({ restaurantId: r.restaurantId, mustChangePassword: false, role: { code: "ADMIN" } });
    expect(await prisma.auditLog.count({ where: { action: "restaurant.signup", restaurantId: r.restaurantId } })).toBe(1);
  });

  it("um restaurante não enxerga nem mexe no outro", async () => {
    const maria = await prisma.user.findUniqueOrThrow({ where: { email: "maria@cantina.com" } });
    const actor = { userId: maria.id, name: maria.name, email: maria.email, role: "ADMIN" as const, restaurantId: maria.restaurantId };
    await expect(openSession(actor, { registerId: env.registers[0].id, shiftId: env.morning.id, businessDate: "2026-10-01", openingFloatCents: 10000, floatMode: "NEW_OPENING" })).rejects.toThrow();
    const list = await listClosings(actor, {});
    expect(list.rows ?? list).toHaveLength(0);
  });
});
