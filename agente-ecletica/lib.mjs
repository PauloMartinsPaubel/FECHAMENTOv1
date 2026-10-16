// Lógica do programa que lê o Eclética B.I e manda os turnos para o Fechamento de Caixa.
// Sem dependências: o acesso ao MySQL e o envio chegam de fora (agente.mjs), o que permite testar tudo aqui.
import { createHash } from "node:crypto";

export const VERSION = "1.0.0";

/** Limites de cada envio (o servidor recusa acima disso). */
export const LIMITS = { turnos: 40, vendas: 8000, bytes: 2_500_000 };

/** Colunas lidas de cada tabela. Dados de cliente (nome, telefone, CPF, endereço) ficam de fora de propósito. */
export const COLUMNS = {
  turnos: ["cod_turno", "data_ini_tur", "data_fim_tur", "vlr_abre", "vlr_fecha", "nome_maquina", "cod_fun"],
  pagamentos: [
    "cod_ctrl", "num_ticket", "cod_turno", "cod_estabelecimento", "data_hora_abre", "data_hora_fecha",
    "vlr_total", "vlr_desc_tot", "vlr_serv", "dinheiro", "cartao", "cheque", "vale_ref", "outros", "fiado",
    "troco", "repique", "flag_dely", "origem_venda", "flag_canc", "id_pedido_externo", "data_hora_canc", "justificativa_cancelamento",
  ],
  det_pagto: ["cod_ctrl", "cod_turno", "tipo_det", "cod_det", "valor"],
  sangrias: ["cod_turno", "data_sangria", "usu", "vlr_sangria_d", "vlr_sangria_t", "vlr_sangria_c", "tipo", "motivo"],
  detalhe: ["tipo_det", "cod_det", "descr_det"],
  origens_vendas: ["flag_dely", "origem_venda", "integrador"],
};

/** Sem estas, não dá para montar o turno: o programa avisa em vez de mandar dados pela metade. */
const REQUIRED = {
  turnos: ["cod_turno", "data_ini_tur"],
  pagamentos: ["cod_ctrl", "num_ticket", "cod_turno", "flag_canc"],
};

/** Nome de base ou tabela vindo da configuração: só letras, números e _ (nada de SQL injetado). */
export function ident(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_]{1,64}$/.test(name)) throw new Error(`Nome inválido na configuração: ${JSON.stringify(name)}`);
  return "`" + name + "`";
}

/** Das colunas que queremos, só as que existem nesta versão da base. */
export function pickColumns(table, available) {
  const have = new Set((available[table] ?? []).map((c) => c.toLowerCase()));
  for (const col of REQUIRED[table] ?? []) {
    if (!have.has(col)) throw new Error(`A tabela ${table} não tem a coluna ${col}. Confira a versão do Eclética B.I.`);
  }
  return COLUMNS[table].filter((c) => have.has(c));
}

const str = (v) => (v === null || v === undefined ? null : String(v).trim() || null);
const money = (v) => (v === null || v === undefined || v === "" ? null : String(v));
const date = (v) => {
  const s = str(v);
  return s && s !== "0000-00-00 00:00:00" ? s.replace("T", " ").slice(0, 19) : null;
};

export function hashOf(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/**
 * Monta um turno no formato do envio a partir das linhas do MySQL.
 * `prefix` separa turnos de bases diferentes (marcas em sistemas separados); `establishment` é a marca
 * dessa base quando a coluna cod_estabelecimento não existe.
 */
export function buildTurno(turno, pagamentos, detalhes, sangrias, { open = false, prefix = "", establishment = null } = {}) {
  const detsByCtrl = new Map();
  for (const d of detalhes) {
    const k = String(d.cod_ctrl);
    if (!detsByCtrl.has(k)) detsByCtrl.set(k, []);
    detsByCtrl.get(k).push({ tipoDet: String(d.tipo_det ?? ""), codDet: String(d.cod_det ?? ""), valor: money(d.valor) });
  }
  return {
    codigo: prefix + String(turno.cod_turno),
    aberto: open,
    abertura: date(turno.data_ini_tur),
    fechamento: open ? null : date(turno.data_fim_tur),
    fundo: money(turno.vlr_abre),
    valorFechamento: open ? null : money(turno.vlr_fecha),
    maquina: str(turno.nome_maquina),
    operador: str(turno.cod_fun),
    vendas: pagamentos.map((p) => ({
      chave: `${p.cod_ctrl}:${p.num_ticket}`,
      estabelecimento: str(p.cod_estabelecimento) ?? establishment,
      abertura: date(p.data_hora_abre),
      fechamento: date(p.data_hora_fecha),
      tipo: str(p.flag_dely),
      origem: str(p.origem_venda),
      situacao: str(p.flag_canc) ?? "*",
      total: money(p.vlr_total),
      desconto: money(p.vlr_desc_tot),
      servico: money(p.vlr_serv),
      colunas: { dinheiro: money(p.dinheiro), cartao: money(p.cartao), cheque: money(p.cheque), vale_ref: money(p.vale_ref), outros: money(p.outros), fiado: money(p.fiado) },
      troco: money(p.troco),
      repique: money(p.repique),
      detalhes: (detsByCtrl.get(String(p.cod_ctrl)) ?? []).slice(0, 30),
      pedidoExterno: str(p.id_pedido_externo),
      canceladaEm: date(p.data_hora_canc),
      motivoCancelamento: str(p.justificativa_cancelamento)?.slice(0, 300) ?? null,
    })),
    sangrias: sangrias.map((s) => ({
      data: date(s.data_sangria),
      operador: str(s.usu),
      d: money(s.vlr_sangria_d),
      t: money(s.vlr_sangria_t),
      c: money(s.vlr_sangria_c),
      tipo: str(s.tipo),
      motivo: str(s.motivo)?.slice(0, 300) ?? null,
    })),
  };
}

/** Divide os turnos em envios dentro dos limites. Um turno nunca é dividido (o servidor troca o turno inteiro). */
export function chunkTurnos(turnos, limits = LIMITS) {
  const chunks = [];
  let cur = [];
  let vendas = 0;
  let bytes = 0;
  for (const t of turnos) {
    const size = JSON.stringify(t).length;
    if (t.vendas.length > limits.vendas || size > limits.bytes) throw new Error(`O turno ${t.codigo} é grande demais para um envio (${t.vendas.length} vendas).`);
    if (cur.length && (cur.length >= limits.turnos || vendas + t.vendas.length > limits.vendas || bytes + size > limits.bytes)) {
      chunks.push(cur);
      cur = [];
      vendas = 0;
      bytes = 0;
    }
    cur.push(t);
    vendas += t.vendas.length;
    bytes += size;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
}

const groupBy = (rows, key) => {
  const m = new Map();
  for (const r of rows) {
    const k = String(r[key]);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
};

/**
 * Comandos para o administrador do MySQL criar o usuário do programa só com leitura das tabelas usadas.
 * Mesmo que alguém mexa no programa, esse usuário não alcança clientes, endereços, funcionários nem fornecedores.
 */
export function permissionScript(config) {
  const user = config.mysql?.user;
  if (typeof user !== "string" || !/^[A-Za-z0-9_]{1,32}$/.test(user)) throw new Error("Preencha mysql.user no config.json (só letras, números e _).");
  const password = String(config.mysql?.password ?? "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const hosts = ["localhost", "127.0.0.1"];
  const lines = hosts.map((h) => `CREATE USER '${user}'@'${h}' IDENTIFIED BY '${password}';`);
  const bases = (config.bases ?? []).flatMap((b) => [b.loja, b.tempoReal].filter(Boolean));
  for (const base of bases) {
    const db = ident(base);
    for (const table of Object.keys(COLUMNS)) for (const h of hosts) lines.push(`GRANT SELECT ON ${db}.\`${table}\` TO '${user}'@'${h}';`);
  }
  return lines.join("\n");
}

/** Lê os turnos de uma base (fechados nos últimos dias, ou todos da base de tempo real) com vendas e sangrias. */
export async function readBase(query, base, { days = 3, open = false, prefix = "", establishment = null } = {}) {
  const db = ident(base);
  const cols = await query(
    "SELECT TABLE_NAME AS t, COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME IN ('turnos','pagamentos','det_pagto','sangrias')",
    [base],
  );
  const available = {};
  for (const r of cols) (available[r.t.toLowerCase()] ??= []).push(r.c);
  const tc = pickColumns("turnos", available);
  const pc = pickColumns("pagamentos", available);
  const dc = available.det_pagto ? COLUMNS.det_pagto.filter((c) => available.det_pagto.map((x) => x.toLowerCase()).includes(c)) : [];
  const sc = available.sangrias ? COLUMNS.sangrias.filter((c) => available.sangrias.map((x) => x.toLowerCase()).includes(c)) : [];

  const turnos = open
    ? await query(`SELECT ${tc.join(", ")} FROM ${db}.turnos`)
    : await query(`SELECT ${tc.join(", ")} FROM ${db}.turnos WHERE data_fim_tur >= DATE_SUB(NOW(), INTERVAL ? DAY)`, [days]);
  if (turnos.length === 0) return [];

  const out = [];
  for (let i = 0; i < turnos.length; i += 200) {
    const part = turnos.slice(i, i + 200);
    const codes = part.map((t) => t.cod_turno);
    const marks = codes.map(() => "?").join(",");
    const [pags, dets, sangs] = await Promise.all([
      query(`SELECT ${pc.join(", ")} FROM ${db}.pagamentos WHERE cod_turno IN (${marks})`, codes),
      dc.length ? query(`SELECT ${dc.join(", ")} FROM ${db}.det_pagto WHERE cod_turno IN (${marks})`, codes) : [],
      sc.length ? query(`SELECT ${sc.join(", ")} FROM ${db}.sangrias WHERE cod_turno IN (${marks})`, codes) : [],
    ]);
    const pagBy = groupBy(pags, "cod_turno");
    const detBy = groupBy(dets, "cod_turno");
    const sanBy = groupBy(sangs, "cod_turno");
    for (const t of part) {
      const k = String(t.cod_turno);
      out.push(buildTurno(t, pagBy.get(k) ?? [], detBy.get(k) ?? [], sanBy.get(k) ?? [], { open, prefix, establishment }));
    }
  }
  return out;
}

/** Nomes das formas de pagamento e dos canais, para o administrador reconhecer os códigos. */
export async function readCatalog(query, base) {
  const db = ident(base);
  const safe = async (sql) => {
    try {
      return await query(sql);
    } catch {
      return [];
    }
  };
  const [formas, canais] = await Promise.all([
    safe(`SELECT tipo_det, cod_det, descr_det FROM ${db}.detalhe`),
    safe(`SELECT flag_dely, origem_venda, integrador FROM ${db}.origens_vendas`),
  ]);
  return {
    formas: formas.slice(0, 500).map((f) => ({ tipoDet: String(f.tipo_det ?? ""), codDet: String(f.cod_det ?? ""), descricao: str(f.descr_det) })),
    canais: canais.slice(0, 500).map((c) => ({ flagDely: String(c.flag_dely ?? ""), origem: String(c.origem_venda ?? ""), integrador: str(c.integrador) })),
  };
}

/**
 * Um ciclo: lê todas as bases, compara com o que já foi enviado (pelo hash de cada turno) e manda só os
 * turnos novos ou mudados. O estado só avança para o que o servidor confirmou.
 */
export async function runOnce({ query, post, config, state, log = () => {} }) {
  const bases = config.bases ?? [];
  if (bases.length === 0) throw new Error("Nenhuma base configurada em \"bases\".");
  const many = bases.length > 1;
  const turnos = [];
  let catalog = { formas: [], canais: [] };
  for (const b of bases) {
    const prefix = many ? `${b.loja}:` : "";
    const establishment = many ? (b.marca ?? b.loja) : null;
    turnos.push(...(await readBase(query, b.loja, { days: config.diasParaConferir ?? 3, prefix, establishment })));
    if (b.tempoReal) turnos.push(...(await readBase(query, b.tempoReal, { open: true, prefix, establishment })));
    const c = await readCatalog(query, b.loja);
    catalog = { formas: [...catalog.formas, ...c.formas], canais: [...catalog.canais, ...c.canais] };
  }
  // o turno que acabou de fechar ainda pode estar na base de tempo real: vale o fechado
  const closedCodes = new Set(turnos.filter((t) => !t.aberto).map((t) => t.codigo));
  for (let i = turnos.length - 1; i >= 0; i--) if (turnos[i].aberto && closedCodes.has(turnos[i].codigo)) turnos.splice(i, 1);

  const hashes = state.hashes ?? {};
  const changed = turnos.filter((t) => hashes[t.codigo] !== hashOf(t));
  const catalogHash = hashOf(catalog);
  const sendCatalog = state.catalogHash !== catalogHash;
  const chunks = chunkTurnos(changed);
  if (chunks.length === 0 && sendCatalog) chunks.push([]);

  let sent = 0;
  for (let i = 0; i < chunks.length; i++) {
    const body = { versao: VERSION, ...(i === 0 && sendCatalog ? { catalogo: catalog } : {}), turnos: chunks[i] };
    const res = await post(body);
    if (!res.ok) throw new Error(`Envio recusado (${res.status}): ${res.erro ?? "sem detalhe"}`);
    for (const t of chunks[i]) hashes[t.codigo] = hashOf(t);
    if (i === 0 && sendCatalog) state.catalogHash = catalogHash;
    sent += chunks[i].length;
  }
  // só guarda o que ainda está na janela, para o arquivo de estado não crescer sem fim
  const current = new Set(turnos.map((t) => t.codigo));
  state.hashes = Object.fromEntries(Object.entries(hashes).filter(([k]) => current.has(k)));
  log(`${turnos.length} turno(s) lidos, ${changed.length} mudaram, ${sent} enviados${sendCatalog ? ", cadastro de formas e canais enviado" : ""}.`);
  return { read: turnos.length, changed: changed.length, sent };
}
