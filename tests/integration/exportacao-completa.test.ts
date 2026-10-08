import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { buildFullExport } from "@/server/services/full-export";
import { registerRestaurant } from "@/server/services/signup";
import { todayIso } from "@/lib/dates";

let env: Env;
beforeAll(async () => {
  env = await bootstrap();
  process.env.SIGNUP_CODE = "conv";
});
afterAll(async () => { delete process.env.SIGNUP_CODE; await prisma.$disconnect(); });

describe("exportação completa", () => {
  it("só administrador; traz os dados do restaurante e nada de outro; sem senha", async () => {
    await registerRestaurant({ inviteCode: "conv", restaurantName: "Outro Lugar", adminName: "Outra Dona", email: "outra@lugar.com", password: "Senha1234", passwordConfirm: "Senha1234", acceptTerms: true }, { bcryptCost: 4 });
    const { session } = await openSession(env.admin, { registerId: env.register.id, shiftId: env.morning.id, businessDate: todayIso(), openingFloatCents: 10000, floatMode: "NEW_OPENING" });
    await expect(buildFullExport(env.manager)).rejects.toThrow(/permissão/);

    const out = await buildFullExport(env.admin);
    const files = unzipSync(out.zip);
    expect(Object.keys(files)).toContain("LEIAME.txt");
    expect(Object.keys(files)).toContain("movimentacoes.csv");
    const users = strFromU8(files["usuarios.csv"]);
    expect(users).toContain(env.admin.email);
    expect(users).not.toContain("outra@lugar.com");
    expect(users.toLowerCase()).not.toContain("passwordhash");
    expect(strFromU8(files["restaurante.csv"])).not.toContain("Outro Lugar");
    const caixas = strFromU8(files["caixas_abertos_e_fechados.csv"]);
    expect(caixas).toContain(session.id);
    expect(caixas).toContain("openingFloat (R$)");
    expect(caixas).toContain("100,00");
    expect(out.counts.caixas_abertos_e_fechados).toBe(1);
  });
});
