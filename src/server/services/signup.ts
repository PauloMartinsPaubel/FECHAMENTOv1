import { timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { audit } from "../audit";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { BCRYPT_COST, seedRestaurantCatalog } from "../seed";
import { cleanName } from "./admin";
import { validatePasswordStrength } from "./auth";
import { parseRecipients } from "./email";

export interface SignupInput {
  inviteCode: string;
  restaurantName: string;
  adminName: string;
  email: string;
  password: string;
  passwordConfirm: string;
}

/** O cadastro só abre com o código de convite (SIGNUP_CODE). Sem a variável, fica fechado. */
export function signupOpen(): boolean {
  return Boolean(process.env.SIGNUP_CODE?.trim());
}

function codeMatches(given: string): boolean {
  const want = Buffer.from(process.env.SIGNUP_CODE?.trim() ?? "");
  const got = Buffer.from(given.trim());
  return want.length > 0 && got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Cria um restaurante novo com os cadastros iniciais (turnos, caixa, canais, formas, bandeiras,
 * fundo de R$ 100) e o primeiro administrador. Tudo numa transação: ou cria tudo, ou nada.
 */
export async function registerRestaurant(input: SignupInput, meta: { ip?: string | null; bcryptCost?: number } = {}) {
  if (!signupOpen()) throw new ServiceError("O cadastro de novos restaurantes está fechado no momento.", "STATE");
  if (!codeMatches(input.inviteCode)) throw new ServiceError("Código de convite inválido.");
  const restaurantName = cleanName(input.restaurantName, "O nome do restaurante");
  const adminName = cleanName(input.adminName, "O seu nome");
  const [email] = parseRecipients(input.email);
  if (!email) throw new ServiceError("Informe o seu e-mail.");
  const weak = validatePasswordStrength(input.password);
  if (weak) throw new ServiceError(weak);
  if (input.password !== input.passwordConfirm) throw new ServiceError("A confirmação da senha não confere.");
  if (await prisma.user.findUnique({ where: { email } })) {
    throw new ServiceError("Este e-mail já tem conta no sistema. Entre pela tela de login.");
  }
  const passwordHash = await bcrypt.hash(input.password, meta.bcryptCost ?? BCRYPT_COST);

  return prisma.$transaction(
    async (tx) => {
      const restaurant = await tx.restaurant.create({ data: { name: restaurantName } });
      await seedRestaurantCatalog(tx, restaurant.id);
      const adminRole = await tx.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
      const user = await tx.user.create({
        data: { restaurantId: restaurant.id, roleId: adminRole.id, name: adminName, email, passwordHash, mustChangePassword: false },
      });
      await audit(tx, { userId: user.id, name: adminName, email, role: "ADMIN", restaurantId: restaurant.id, ip: meta.ip ?? null }, {
        action: "restaurant.signup",
        entity: "restaurant",
        entityId: restaurant.id,
        newValue: { restaurant: restaurantName, admin: email },
      });
      return { restaurantId: restaurant.id, userId: user.id, email };
    },
    { timeout: 30_000 },
  );
}
