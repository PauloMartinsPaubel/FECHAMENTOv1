// Programa do restaurante: lê o Eclética B.I (MySQL local) e manda os turnos para o Fechamento de Caixa.
// Uso:
//   node agente.mjs            fica rodando e envia a cada "intervaloMinutos"
//   node agente.mjs --uma-vez  envia uma vez e sai (para usar depois de forçar o sincronismo do B.I)
//   node agente.mjs --testar   só lê o banco e mostra o que mandaria, sem enviar nada
//   node agente.mjs --permissoes  mostra os comandos para criar o usuário de leitura no MySQL
import { appendFileSync, existsSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import mysql from "mysql2/promise";
import { VERSION, permissionScript, readBase, runOnce } from "./lib.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const CONFIG = join(here, "config.json");
const STATE = join(here, "estado.json");
const LOG = join(here, "agente.log");

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  try {
    if (existsSync(LOG) && statSync(LOG).size > 1_000_000) renameSync(LOG, LOG + ".antigo");
    appendFileSync(LOG, line);
  } catch {
    // sem log em arquivo não impede o envio
  }
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

const config = loadJson(CONFIG, null);
if (!config) {
  log("Falta o arquivo config.json. Copie config.exemplo.json para config.json e preencha.");
  process.exit(1);
}
for (const field of ["url", "chave", "mysql", "bases"]) {
  if (!config[field]) {
    log(`config.json sem o campo "${field}".`);
    process.exit(1);
  }
}
if (!/^https:\/\//.test(config.url) && !/^http:\/\/(localhost|127\.0\.0\.1)/.test(config.url)) {
  log("O endereço em \"url\" precisa começar com https://.");
  process.exit(1);
}

if (process.argv.includes("--permissoes")) {
  // não vai para o arquivo de log: tem a senha
  process.stdout.write(permissionScript(config) + "\n");
  process.exit(0);
}

const pool = mysql.createPool({
  host: config.mysql.host ?? "127.0.0.1",
  port: config.mysql.port ?? 3306,
  user: config.mysql.user,
  password: config.mysql.password,
  // datas como texto (horário local da Eclética) e decimais como texto (sem erro de arredondamento)
  dateStrings: true,
  decimalNumbers: false,
  charset: "utf8",
  connectionLimit: 2,
});
const query = async (sql, params = []) => (await pool.query(sql, params))[0];

async function post(body) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 90_000);
  try {
    const res = await fetch(config.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${config.chave}`, "user-agent": `agente-ecletica/${VERSION}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok && data.ok === true, status: res.status, erro: data.erro };
  } finally {
    clearTimeout(timer);
  }
}

async function cycle() {
  const state = loadJson(STATE, {});
  try {
    await runOnce({ query, post, config, state, log });
  } finally {
    // guarda o que já foi confirmado, mesmo se um envio do meio falhar
    writeFileSync(STATE, JSON.stringify(state));
  }
}

async function test() {
  for (const b of config.bases) {
    const closed = await readBase(query, b.loja, { days: config.diasParaConferir ?? 3 });
    log(`${b.loja}: ${closed.length} turno(s) fechado(s) nos últimos dias, ${closed.reduce((a, t) => a + t.vendas.length, 0)} venda(s).`);
    if (closed[0]) log(`Exemplo do primeiro turno: ${JSON.stringify({ ...closed[0], vendas: closed[0].vendas.slice(0, 2) })}`);
    if (b.tempoReal) {
      const open = await readBase(query, b.tempoReal, { open: true });
      log(`${b.tempoReal}: ${open.length} turno(s) aberto(s), ${open.reduce((a, t) => a + t.vendas.length, 0)} venda(s).`);
    }
  }
}

const args = process.argv.slice(2);
try {
  if (args.includes("--testar")) {
    await test();
  } else if (args.includes("--uma-vez")) {
    await cycle();
  } else {
    const minutes = Math.max(1, Number(config.intervaloMinutos ?? 5));
    log(`Programa ${VERSION} iniciado. Enviando a cada ${minutes} minuto(s).`);
    for (;;) {
      try {
        await cycle();
      } catch (err) {
        log(`Erro: ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, minutes * 60_000));
    }
  }
} catch (err) {
  log(`Erro: ${err.message}`);
  process.exitCode = 1;
} finally {
  if (args.includes("--testar") || args.includes("--uma-vez")) await pool.end();
}
