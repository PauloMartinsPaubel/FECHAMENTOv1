import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { localToUtc, parsePayload } from "@/server/integrations/ecletica/payload";
import { ecleticaStatus, generateEcleticaToken, ingestEcletica, integrationFromToken, setEcleticaEnabled } from "@/server/services/ecletica";

let env: Env;
let token: string;

beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

const venda = (chave: string, over: Record<string, unknown> = {}) => ({
  chave,
  estabelecimento: "1",
  abertura: "2026-10-16 12:01:00",
  fechamento: "2026-10-16 12:20:00",
  tipo: "D",
  origem: "IFOOD",
  situacao: "*",
  total: "59.90",
  desconto: "0.00",
  servico: "7.00",
  colunas: { dinheiro: "0.00", cartao: "66.90" },
  troco: "0.00",
  detalhes: [{ tipoDet: "C", codDet: "12", valor: "66.90" }],
  pedidoExterno: "IF-998",
  ...over,
});

const turno = (codigo: string, vendas: ReturnType<typeof venda>[], over: Record<string, unknown> = {}) => ({
  codigo,
  aberto: false,
  abertura: "2026-10-16 10:00:00",
  fechamento: "2026-10-16 15:30:00",
  fundo: "100.00",
  valorFechamento: "1234.56",
  maquina: "CAIXA01",
  operador: "7",
  vendas,
  sangrias: [{ data: "2026-10-16 14:00:00", operador: "Ana", d: "200.00", t: "0", c: "0", tipo: "S", motivo: "cofre" }],
  ...over,
});

function parse(body: unknown) {
  const r = parsePayload(body);
  if (!r.ok) throw new Error(r.error);
  return r.data;
}

describe("integração com a Eclética: recebimento", () => {
  it("só o administrador gera a chave; a chave identifica o restaurante e gerar de novo invalida a antiga", async () => {
    await expect(generateEcleticaToken(env.manager)).rejects.toThrow();
    const first = await generateEcleticaToken(env.admin);
    token = await generateEcleticaToken(env.admin);
    expect(token.startsWith("ecl_")).toBe(true);
    expect(await integrationFromToken(first)).toBeNull();
    expect((await integrationFromToken(token))?.restaurantId).toBe(env.restaurantId);
    expect(await integrationFromToken("ecl_inventada")).toBeNull();
    expect(await integrationFromToken(undefined)).toBeNull();
    const row = await prisma.platformIntegration.findFirstOrThrow({ where: { provider: "ECLETICA" } });
    expect(row.agentTokenHash).not.toContain(token);
  });

  it("valida o envio e explica o erro", () => {
    expect(parsePayload({ turnos: [{ codigo: "1" }] })).toMatchObject({ ok: false });
    const bad = parsePayload({ turnos: [turno("1", [venda("1:1", { fechamento: "16/10/2026" })])] });
    expect(bad.ok ? "" : bad.error).toMatch(/fechamento/);
    expect(parsePayload({ turnos: [turno("1", [venda("1:1")])] }).ok).toBe(true);
  });

  it("horário local da Eclética vira o instante certo no fuso do restaurante", () => {
    expect(localToUtc("2026-10-16 12:00:00")?.toISOString()).toBe("2026-10-16T15:00:00.000Z");
    expect(localToUtc(null)).toBeNull();
  });

  it("grava turno, vendas e sangrias, sem dados de cliente, e guarda os códigos vistos", async () => {
    const integration = (await integrationFromToken(token))!;
    const payload = parse({
      versao: "1.0.0",
      catalogo: { formas: [{ tipoDet: "C", codDet: "12", descricao: "VISA CRÉDITO" }], canais: [{ flagDely: "D", origem: "IFOOD", integrador: "iFood" }] },
      turnos: [turno("4178", [venda("10:-5"), venda("11:-6", { estabelecimento: "2", origem: "IFOOD2", colunas: { dinheiro: "30.00" }, detalhes: [], troco: "5.00" })])],
      nome_cliente: "não deve ser guardado",
    });
    const r = await ingestEcletica(env.restaurantId, integration.id, payload);
    expect(r).toEqual({ turnos: 1, vendas: 2, sangrias: 1, ignorados: 0 });
    const shift = await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4178" }, include: { sales: true, cashMoves: true } });
    expect(shift).toMatchObject({ floatCents: 10000, closingCents: 123456, open: false, machine: "CAIXA01" });
    expect(shift.openedAt.toISOString()).toBe("2026-10-16T13:00:00.000Z");
    const ifood = shift.sales.find((s) => s.externalKey === "10:-5")!;
    expect(ifood).toMatchObject({ totalCents: 5990, serviceCents: 700, establishment: "1", externalOrderId: "IF-998", status: "*" });
    expect(ifood.byColumn).toEqual({ cartao: 6690 });
    expect(ifood.details).toEqual([{ key: "C|12", valueCents: 6690 }]);
    expect(shift.sales.find((s) => s.externalKey === "11:-6")).toMatchObject({ changeCents: 500, byColumn: { dinheiro: 3000 } });
    expect(shift.cashMoves[0]).toMatchObject({ dCents: 20000, reason: "cofre" });
    expect(JSON.stringify(shift)).not.toContain("não deve ser guardado");

    const codes = await prisma.ecleticaCode.findMany({ where: { restaurantId: env.restaurantId } });
    const keys = codes.map((c) => `${c.kind}:${c.externalKey}`).sort();
    expect(keys).toEqual(["CANAL:D|IFOOD", "CANAL:D|IFOOD2", "ESTABELECIMENTO:1", "ESTABELECIMENTO:2", "FORMA:C|12", "FORMA:cartao", "FORMA:dinheiro"].sort());
    expect(codes.find((c) => c.externalKey === "C|12")?.label).toBe("VISA CRÉDITO");
  });

  it("o mesmo turno de novo substitui tudo daquele turno, sem duplicar", async () => {
    const integration = (await integrationFromToken(token))!;
    await ingestEcletica(env.restaurantId, integration.id, parse({ turnos: [turno("4178", [venda("10:-5", { situacao: "C", canceladaEm: "2026-10-16 12:30:00", motivoCancelamento: "cliente desistiu" })], { sangrias: [] })] }));
    const shift = await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4178" }, include: { sales: true, cashMoves: true } });
    expect(shift.sales).toHaveLength(1);
    expect(shift.sales[0]).toMatchObject({ status: "C", cancelReason: "cliente desistiu" });
    expect(shift.cashMoves).toHaveLength(0);
    expect(await prisma.ecleticaShift.count()).toBe(1);
  });

  it("turno aberto (tempo real) entra, é trocado pelo fechado, e nunca volta por cima do fechado", async () => {
    const integration = (await integrationFromToken(token))!;
    const aberto = turno("4179", [venda("20:-1")], { aberto: true, fechamento: null, valorFechamento: null });
    await ingestEcletica(env.restaurantId, integration.id, parse({ turnos: [aberto] }));
    expect(await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4179" } })).toMatchObject({ open: true, closedAt: null });
    await ingestEcletica(env.restaurantId, integration.id, parse({ turnos: [turno("4179", [venda("20:-1"), venda("21:-2")])] }));
    const r = await ingestEcletica(env.restaurantId, integration.id, parse({ turnos: [aberto] }));
    expect(r.ignorados).toBe(1);
    const closed = await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4179" }, include: { sales: true } });
    expect(closed.open).toBe(false);
    expect(closed.sales).toHaveLength(2);

    // o mesmo turno aberto e fechado no mesmo envio, com o aberto por último: vale o fechado
    const aberto2 = turno("4180", [venda("30:-1")], { aberto: true, fechamento: null, valorFechamento: null });
    await ingestEcletica(env.restaurantId, integration.id, parse({ turnos: [turno("4180", [venda("30:-1"), venda("31:-2")]), aberto2] }));
    const both = await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4180" }, include: { sales: true } });
    expect(both.open).toBe(false);
    expect(both.sales).toHaveLength(2);
  });

  it("situação aparece em Integrações; desligada, a chave continua valendo mas o envio é recusado na rota", async () => {
    const st = await ecleticaStatus(env.manager);
    // os últimos 7 dias contam pela abertura do turno
    expect(await ecleticaStatus(env.manager, new Date("2026-10-18T12:00:00Z"))).toMatchObject({ shifts7d: 3, sales7d: 5 });
    expect(await ecleticaStatus(env.manager, new Date("2026-10-30T12:00:00Z"))).toMatchObject({ shifts7d: 0, sales7d: 0 });
    expect(st).toMatchObject({ configured: true, enabled: true, lastSyncOk: true });
    expect(st.lastSyncInfo).toMatch(/turno/);
    await setEcleticaEnabled(env.admin, false);
    expect((await integrationFromToken(token))?.enabled).toBe(false);
    await expect(setEcleticaEnabled(env.manager, true)).rejects.toThrow();
  });
});
