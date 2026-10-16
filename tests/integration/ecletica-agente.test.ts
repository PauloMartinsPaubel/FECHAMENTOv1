import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { bootstrap, Env } from "./setup";
import { parsePayload } from "@/server/integrations/ecletica/payload";
import { generateEcleticaToken, ingestEcletica, integrationFromToken } from "@/server/services/ecletica";
import { chunkTurnos, ident, permissionScript, runOnce, type Row } from "../../agente-ecletica/lib.mjs";

/**
 * O programa do restaurante e o servidor juntos: linhas como o MySQL do Eclética B.I devolve
 * (datas e decimais em texto) passam pelo programa, pela validação do servidor e chegam ao banco.
 */
let env: Env;
let integrationId: string;

const db = {
  turnos: [
    { cod_turno: 4178, data_ini_tur: "2026-10-16 10:00:00", data_fim_tur: "2026-10-16 15:30:00", vlr_abre: "100.00", vlr_fecha: "980.50", nome_maquina: "CAIXA01", cod_fun: 7 },
  ] as Row[],
  pagamentos: [
    { cod_ctrl: 10, num_ticket: -5, cod_turno: 4178, cod_estabelecimento: 1, data_hora_abre: "2026-10-16 12:01:00", data_hora_fecha: "2026-10-16 12:20:00", vlr_total: "59.90", vlr_desc_tot: "0.00", vlr_serv: "7.00", dinheiro: "0.00", cartao: "66.90", cheque: "0.00", vale_ref: "0.00", outros: "0.00", fiado: "0.00", troco: "0.00", repique: "0.00", flag_dely: "D", origem_venda: "IFOOD", flag_canc: "*", id_pedido_externo: "IF-1", data_hora_canc: null, justificativa_cancelamento: null, nome_cliente: "Fulano", telefone: "11999999999" },
    { cod_ctrl: 11, num_ticket: -6, cod_turno: 4178, cod_estabelecimento: 2, data_hora_abre: "2026-10-16 13:00:00", data_hora_fecha: "2026-10-16 13:10:00", vlr_total: "30.00", vlr_desc_tot: "0.00", vlr_serv: "0.00", dinheiro: "35.00", cartao: "0.00", cheque: "0.00", vale_ref: "0.00", outros: "0.00", fiado: "0.00", troco: "5.00", repique: "0.00", flag_dely: "B", origem_venda: "", flag_canc: "*", id_pedido_externo: null, data_hora_canc: null, justificativa_cancelamento: null, nome_cliente: "Ciclana", telefone: "11888888888" },
  ] as Row[],
  det_pagto: [{ cod_ctrl: 10, cod_turno: 4178, tipo_det: "C", cod_det: 12, valor: "66.90" }] as Row[],
  sangrias: [{ cod_turno: 4178, data_sangria: "2026-10-16 14:00:00", usu: "Ana", vlr_sangria_d: "200.00", vlr_sangria_t: "0.00", vlr_sangria_c: "0.00", tipo: "S", motivo: "cofre" }] as Row[],
  detalhe: [{ tipo_det: "C", cod_det: 12, descr_det: "VISA CRÉDITO" }] as Row[],
  origens_vendas: [{ flag_dely: "D", origem_venda: "IFOOD", integrador: "iFood" }] as Row[],
};
// colunas que existem na base (sem as de cliente na lista do programa, mesmo existindo aqui)
const columns = ["turnos", "pagamentos", "det_pagto", "sangrias"].flatMap((t) =>
  Object.keys((db as Record<string, Row[]>)[t][0]).map((c) => ({ t, c })),
);

const sqls: string[] = [];
async function query(sql: string, params: unknown[] = []): Promise<Row[]> {
  sqls.push(sql);
  if (sql.includes("information_schema")) return columns;
  const table = sql.match(/FROM `[^`]+`\.(\w+)/)?.[1] ?? "";
  const cols = sql.match(/^SELECT (.+?) FROM/)?.[1].split(", ").map((c) => c.trim()) ?? [];
  let rows = (db as Record<string, Row[]>)[table] ?? [];
  if (sql.includes("cod_turno IN")) rows = rows.filter((r) => params.map(String).includes(String(r.cod_turno)));
  return rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c]])));
}

const bodies: Record<string, unknown>[] = [];
async function post(body: Record<string, unknown>) {
  bodies.push(body);
  const parsed = parsePayload(JSON.parse(JSON.stringify(body)));
  if (!parsed.ok) return { ok: false, status: 400, erro: parsed.error };
  const integration = await prisma.platformIntegration.findUniqueOrThrow({ where: { id: integrationId } });
  await ingestEcletica(integration.restaurantId, integration.id, parsed.data);
  return { ok: true, status: 200 };
}

beforeAll(async () => {
  env = await bootstrap();
  const token = await generateEcleticaToken(env.admin);
  integrationId = (await integrationFromToken(token))!.id;
});
afterAll(async () => {
  await prisma.$disconnect();
});

describe("programa da Eclética até o banco", () => {
  const config = { bases: [{ loja: "00012978ecleticaloja_bi" }], diasParaConferir: 3 };
  const state: { hashes?: Record<string, string>; catalogHash?: string } = {};

  it("lê, manda e o servidor grava; dados de cliente nem são consultados", async () => {
    const r = await runOnce({ query, post, config, state });
    expect(r).toEqual({ read: 1, changed: 1, sent: 1 });
    expect(sqls.some((s) => /nome_cliente|telefone|cpf/.test(s))).toBe(false);
    expect(JSON.stringify(bodies)).not.toContain("Fulano");
    const shift = await prisma.ecleticaShift.findFirstOrThrow({ where: { externalId: "4178" }, include: { sales: true, cashMoves: true } });
    expect(shift.floatCents).toBe(10000);
    expect(shift.sales.map((s) => [s.externalKey, s.establishment, s.totalCents]).sort()).toEqual([["10:-5", "1", 5990], ["11:-6", "2", 3000]]);
    expect(shift.sales.find((s) => s.externalKey === "10:-5")?.details).toEqual([{ key: "C|12", valueCents: 6690 }]);
    expect(shift.cashMoves).toHaveLength(1);
    const forma = await prisma.ecleticaCode.findFirst({ where: { kind: "FORMA", externalKey: "C|12" } });
    expect(forma?.label).toBe("VISA CRÉDITO");
  });

  it("sem mudança, o próximo ciclo não manda nada", async () => {
    const before = bodies.length;
    expect(await runOnce({ query, post, config, state })).toEqual({ read: 1, changed: 0, sent: 0 });
    expect(bodies.length).toBe(before);
  });

  it("turno recém-fechado que ainda aparece na base de tempo real não vai de novo como aberto", async () => {
    const before = bodies.length;
    const withLive = { ...config, bases: [{ loja: "00012978ecleticaloja_bi", tempoReal: "00012978ecleticavendas_bi" }] };
    expect(await runOnce({ query, post, config: withLive, state })).toEqual({ read: 1, changed: 0, sent: 0 });
    expect(bodies.length).toBe(before);
  });

  it("venda cancelada depois na Eclética: o turno vai de novo, já corrigido", async () => {
    db.pagamentos[0] = { ...db.pagamentos[0], flag_canc: "C", data_hora_canc: "2026-10-16 12:40:00", justificativa_cancelamento: "cliente desistiu" };
    expect((await runOnce({ query, post, config, state })).sent).toBe(1);
    const sale = await prisma.ecleticaSale.findFirstOrThrow({ where: { externalKey: "10:-5" } });
    expect(sale).toMatchObject({ status: "C", cancelReason: "cliente desistiu" });
    expect(await prisma.ecleticaSale.count()).toBe(2);
  });

  it("recusa do servidor não marca o turno como enviado", async () => {
    db.pagamentos[1] = { ...db.pagamentos[1], vlr_total: "31.00" };
    const failing = async () => ({ ok: false, status: 500, erro: "fora do ar" });
    await expect(runOnce({ query, post: failing, config, state })).rejects.toThrow(/fora do ar/);
    expect((await runOnce({ query, post, config, state })).sent).toBe(1);
  });

  it("nome de base com SQL é recusado, e envios grandes são divididos sem partir turno", () => {
    expect(() => ident("loja; DROP TABLE x")).toThrow();
    expect(ident("00012978ecleticaloja_bi")).toBe("`00012978ecleticaloja_bi`");
    const t = (n: number, vendas: number) => ({ codigo: String(n), aberto: false, vendas: Array.from({ length: vendas }, () => ({})), sangrias: [] });
    const chunks = chunkTurnos([t(1, 5), t(2, 5), t(3, 5)], { turnos: 2, vendas: 100, bytes: 1_000_000 });
    expect(chunks.map((c) => c.map((x) => x.codigo))).toEqual([["1", "2"], ["3"]]);
    expect(() => chunkTurnos([t(1, 50)], { turnos: 10, vendas: 10, bytes: 1_000_000 })).toThrow(/grande demais/);
  });

  it("o usuário do MySQL sugerido só lê as seis tabelas usadas, nada de clientes", () => {
    const sql = permissionScript({ mysql: { user: "fechamento_leitura", password: "a'b" }, bases: [{ loja: "loja_bi", tempoReal: "vendas_bi" }] });
    const grants = sql.split("\n").filter((l) => l.startsWith("GRANT"));
    expect(grants).toHaveLength(2 * 6 * 2);
    expect(grants.every((g) => g.startsWith("GRANT SELECT ON "))).toBe(true);
    expect(sql).not.toMatch(/clientes|enderecos|funcionarios|fornecedores|\*/);
    expect(sql).toContain("IDENTIFIED BY 'a\\'b'");
    expect(() => permissionScript({ mysql: { user: "x'; DROP USER root; --" }, bases: [] })).toThrow();
    expect(() => permissionScript({ mysql: { user: "ok" }, bases: [{ loja: "a`b" }] })).toThrow();
  });
});
