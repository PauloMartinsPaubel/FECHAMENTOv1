import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { closeSession } from "@/server/services/closing";
import { todayIso } from "@/lib/dates";

let env: Env;
beforeAll(async () => { env = await bootstrap(); });
afterAll(async () => { await prisma.$disconnect(); });

describe("operador abrindo caixa já fechado por outra pessoa", () => {
  it("recebe explicação em vez de ser levado a um caixa que não pode ver; gerente vai para o caixa", async () => {
    const input = { registerId: env.registers[1].id, shiftId: env.morning.id, businessDate: todayIso(), openingFloatCents: 0, floatMode: "NEW_OPENING" as const };
    const { session } = await openSession(env.admin, input);
    await closeSession(env.admin, session.id, {});
    await expect(openSession(env.operator, input)).rejects.toThrow(/já foi aberto e fechado/);
    const again = await openSession(env.manager, input);
    expect(again.session.id).toBe(session.id);
    expect(again.created).toBe(false);
  });
});
