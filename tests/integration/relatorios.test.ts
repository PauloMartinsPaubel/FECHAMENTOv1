import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SMTPServer } from "smtp-server";
import { simpleParser, ParsedMail } from "mailparser";
import type { AddressInfo } from "node:net";
import { prisma } from "@/server/db";
import { todayIso } from "@/lib/dates";
import { bootstrap, Env } from "./setup";
import { openSession } from "@/server/services/sessions";
import { cancelSale, createMovement } from "@/server/services/movements";
import { saveConference } from "@/server/services/conference";
import { closeSession } from "@/server/services/closing";
import { loadSessionBundle } from "@/server/loaders";
import { buildDayReport, buildPeriodReport, listAudit, listClosings, listCorrections } from "@/server/services/queries";
import { buildExport } from "@/server/reports/export";
import { sendClosingEmail } from "@/server/services/email";
import { buildShiftReportData } from "@/server/reports/shift-data";
import { renderDayReport, renderShiftReport } from "@/lib/reports/html";
import { changeOwnPassword, loginWithPassword, userFromToken, MAX_FAILED_LOGINS } from "@/server/services/auth";
import { createUser, updateUser, savePaymentMethod, saveSettings } from "@/server/services/admin";

const R = (n: number) => Math.round(n * 100);
const DAY = "2021-03-15";
let env: Env;

beforeAll(async () => {
  env = await bootstrap();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Cria, preenche, confere e fecha um caixa. */
async function closedSession(opts: {
  register: number; shift: "morning" | "evening"; date?: string; float?: number; mode?: "NEW_OPENING" | "TRANSFER"; from?: string;
  sales: { kind: string; cents: number; channel?: string; brand?: string }[];
  sangria?: number; cashCounted?: (expected: number) => number; cardShort?: number; justification?: string; note?: string;
}) {
  const shift = opts.shift === "morning" ? env.morning : env.evening;
  const { session } = await openSession(env.manager, {
    registerId: env.registers[opts.register].id, shiftId: shift.id, businessDate: opts.date ?? DAY,
    openingFloatCents: opts.float ?? R(100), floatMode: opts.mode ?? "NEW_OPENING", transferredFromId: opts.from,
  });
  for (const s of opts.sales) {
    await createMovement(env.manager, session.id, {
      type: "VENDA", amountCents: s.cents, channelId: env.ch(s.channel ?? "Balcão"), paymentMethodId: env.pm(s.kind),
      ticketBrandId: s.brand ? env.brand(s.brand) : null,
    });
  }
  if (opts.sangria) await createMovement(env.manager, session.id, { type: "SANGRIA", amountCents: opts.sangria, description: "Cofre" });
  const b = await loadSessionBundle(prisma, env.restaurantId, session.id);
  const values: Record<string, number> = {};
  for (const l of b.evaluation.lines) {
    values[l.key] = l.key === "cash" ? (opts.cashCounted ? opts.cashCounted(l.expectedCents) : l.expectedCents)
      : l.group === "DEBIT" && opts.cardShort ? l.expectedCents - opts.cardShort : l.expectedCents;
  }
  await saveConference(env.manager, session.id, values);
  await closeSession(env.manager, session.id, { justification: opts.justification, notes: opts.note });
  return session;
}

describe("dia consolidado, fundo novo x transferido", () => {
  let morning: { id: string };
  beforeAll(async () => {
    morning = await closedSession({
      register: 3, shift: "morning",
      sales: [{ kind: "Dinheiro", cents: R(850) }, { kind: "Cartão de crédito", cents: R(600) }, { kind: "PIX", cents: R(100) }],
      sangria: R(850),
    });
  });

  it("turno da tarde com fundo transferido não soma o fundo de novo", async () => {
    await closedSession({
      register: 3, shift: "evening", mode: "TRANSFER", from: morning.id,
      sales: [
        { kind: "Dinheiro", cents: R(400) }, { kind: "Cartão de débito", cents: R(300) },
        { kind: "Tickets / Vales", cents: R(150), brand: "Alelo" }, { kind: "Pagamento online", cents: R(500), channel: "iFood" },
      ],
      cardShort: R(20), justification: "Máquina de débito apresentou diferença de R$ 20",
    });
    const day = await buildDayReport(env.manager, DAY);
    const c = day.consolidation;
    expect(c.shifts.map((s) => s.shiftName)).toEqual(["Manhã", "Tarde/Noite"]);
    expect(c.shifts[0].headline.revenueCents).toBe(R(1550));
    expect(c.shifts[1].headline.revenueCents).toBe(R(1350));
    expect(c.total.revenueCents).toBe(R(2900));
    expect(c.total.cashSalesCents).toBe(R(1250));
    expect(c.total.cardsCents).toBe(R(900));
    expect(c.total.ticketsCents).toBe(R(150));
    expect(c.total.onlineCents).toBe(R(500));
    expect(c.total.divergenceNetCents).toBe(-R(20));
    expect(c.floatCents).toBe(R(100)); // só a abertura da manhã
    expect(c.transferredFloatCents).toBe(R(100));
    expect(c.floatLines.map((f) => [f.shiftName, f.floatCents, f.countsAsNewEntry])).toEqual([
      ["Manhã", R(100), true], ["Tarde/Noite", R(100), false],
    ]);
    expect(c.controlledCents).toBe(R(3000));
    const html = renderDayReport(day);
    expect(html).toContain("Fechamento geral do dia");
    expect(html).toContain("transferido, não soma de novo");
  });

  it("a transferência exige turno anterior fechado, do mesmo caixa e dia", async () => {
    await expect(
      openSession(env.manager, { registerId: env.registers[4].id, shiftId: env.evening.id, businessDate: DAY, openingFloatCents: R(100), floatMode: "TRANSFER", transferredFromId: morning.id }),
    ).rejects.toThrow(/mesmo caixa/);
    await expect(
      openSession(env.manager, { registerId: env.registers[3].id, shiftId: env.evening.id, businessDate: "2021-03-16", openingFloatCents: R(100), floatMode: "TRANSFER", transferredFromId: morning.id }),
    ).rejects.toThrow(/mesmo dia/);
  });

  it("abrir de novo o mesmo turno devolve o existente e não reaproveita o fundo", async () => {
    // Caixa 4: manhã fecha, tarde usa o fundo; nova tentativa no mesmo turno devolve a sessão já criada
    const m = await closedSession({ register: 4, shift: "morning", date: "2021-03-16", sales: [{ kind: "PIX", cents: R(10) }] });
    await closedSession({ register: 4, shift: "evening", date: "2021-03-16", mode: "TRANSFER", from: m.id, sales: [{ kind: "PIX", cents: R(10) }] });
    await expect(
      openSession(env.manager, { registerId: env.registers[4].id, shiftId: env.evening.id, businessDate: "2021-03-16", openingFloatCents: R(100), floatMode: "TRANSFER", transferredFromId: m.id }),
    ).resolves.toMatchObject({ created: false });
  });
});

describe("relatórios de período", () => {
  it("totaliza por dia, turno, funcionário, canal e forma; lista divergências", async () => {
    const r = await buildPeriodReport(env.manager, { from: DAY, to: DAY });
    expect(r.sessionCount).toBe(2);
    expect(r.totals.revenueCents).toBe(R(2900));
    expect(r.byDay).toHaveLength(1);
    expect(r.byShift.map((s) => s.label)).toEqual(["Manhã", "Tarde/Noite"]);
    expect(r.byEmployee[0].label).toBe("Gabriela Gerente");
    expect(r.byChannel.find((c) => c.name === "iFood")?.netCents).toBe(R(500));
    expect(r.byChannel.find((c) => c.name === "Balcão")?.netCents).toBe(R(2400));
    expect(r.byChannel.reduce((a, c) => a + c.netCents, 0)).toBe(r.totals.revenueCents);
    expect(r.byKind.reduce((a, k) => a + k.netCents, 0)).toBe(r.totals.revenueCents);
    expect(r.divergences).toHaveLength(1);
    expect(r.divergences[0]).toMatchObject({ status: "FALTA", netCents: -R(20), shiftName: "Tarde/Noite" });
    expect(r.divergences[0].justification).toContain("Máquina de débito");
    expect(r.floatCents).toBe(R(100)); // fundo transferido fora
    expect(r.controlledCents).toBe(R(3000));
  });

  it("filtro por canal recalcula só o que pertence ao canal", async () => {
    const r = await buildPeriodReport(env.manager, { from: DAY, to: DAY, channelId: env.ch("iFood") });
    expect(r.scoped).toBe(true);
    expect(r.totals.revenueCents).toBe(R(500));
    expect(r.totals.onlineCents).toBe(R(500));
    expect(r.totals.cashSalesCents).toBe(0);
  });

  it("filtro por forma de pagamento", async () => {
    const r = await buildPeriodReport(env.manager, { from: DAY, to: DAY, paymentMethodId: env.pm("Dinheiro") });
    expect(r.totals.revenueCents).toBe(R(1250));
  });

  it("período inválido ou longo demais é recusado", async () => {
    await expect(buildPeriodReport(env.manager, { from: "2021-03-16", to: "2021-03-15" })).rejects.toThrow(/depois da final/);
    await expect(buildPeriodReport(env.manager, { from: "2000-01-01", to: "2021-03-15" })).rejects.toThrow(/longo demais/);
  });

  it("a foto gravada no fechamento é idêntica ao cálculo ao vivo", async () => {
    const closing = await prisma.cashClosing.findFirstOrThrow({ where: { session: { businessDate: new Date(`${DAY}T00:00:00Z`) } }, orderBy: { closedAt: "asc" } });
    const live = buildShiftReportData(await loadSessionBundle(prisma, env.restaurantId, closing.sessionId));
    const snap = closing.snapshot as any;
    const strip = (x: any) => ({ ...x, generatedAt: null });
    expect(strip(live).totals).toEqual(strip(snap).totals);
    expect(strip(live).conference).toEqual(strip(snap).conference);
    expect(strip(live).divergence).toEqual(strip(snap).divergence);
    expect(strip(live).matrix).toEqual(strip(snap).matrix);
  });

  it("histórico lista os fechamentos com filtro", async () => {
    const h = await listClosings(env.manager, { from: DAY, to: DAY });
    expect(h.total).toBe(2);
    const faltas = await listClosings(env.manager, { status: "FALTA" });
    expect(faltas.rows.every((c) => c.status === "FALTA")).toBe(true);
  });
});

describe("relatório do turno (HTML)", () => {
  it("traz todos os blocos do pedido e escapa texto digitado", async () => {
    const { session } = await openSession(env.manager, { registerId: env.registers[5].id, shiftId: env.morning.id, businessDate: "2021-03-20", openingFloatCents: R(100), floatMode: "NEW_OPENING" });
    await createMovement(env.manager, session.id, { type: "VENDA", amountCents: R(100), orderNumber: "1", channelId: env.ch("Balcão"), paymentMethodId: env.pm("Dinheiro") });
    await createMovement(env.manager, session.id, { type: "DESPESA", amountCents: R(10), paymentMethodId: env.pm("Dinheiro"), description: "<script>alert(1)</script>" });
    const bundle = await loadSessionBundle(prisma, env.restaurantId, session.id);
    const html = renderShiftReport(buildShiftReportData(bundle), await listCorrections(prisma, env.restaurantId, session.id));
    for (const part of ["Relatório de fechamento de caixa", "Fundo inicial", "FATURAMENTO", "DINHEIRO ESPERADO", "Canal x forma de pagamento", "PRÉVIA"]) {
      expect(html).toContain(part);
    }
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("exportação CSV", () => {
  it("fechamento: BOM, separador ;, decimal com vírgula, valores certos", async () => {
    const out = await buildExport(env.manager, { dataset: "fechamento", from: DAY, to: DAY });
    expect(out.csv.startsWith("﻿")).toBe(true);
    const [head, ...lines] = out.csv.trim().split("\r\n");
    expect(head).toContain("Fundo de abertura;Faturamento");
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain(";100,00;1550,00;");
    expect(out.rows).toBe(2);
  });

  it("vendas, movimentações, cancelamentos, divergências, cartões, dinheiro, tickets, PIX e conferência exportam", async () => {
    for (const dataset of ["vendas", "movimentacoes", "cancelamentos", "divergencias", "cartoes", "dinheiro", "tickets", "pix", "conferencia"] as const) {
      const out = await buildExport(env.manager, { dataset, from: DAY, to: DAY });
      expect(out.csv.split("\r\n")[0]).toContain("ID;Data;Turno");
    }
    const div = await buildExport(env.manager, { dataset: "divergencias", from: DAY, to: DAY });
    expect(div.rows).toBe(1);
    expect(div.csv).toContain("-20,00");
    const dinheiro = await buildExport(env.manager, { dataset: "dinheiro", from: DAY, to: DAY });
    expect(dinheiro.rows).toBe(2);
    const mov = await buildExport(env.manager, { dataset: "movimentacoes", from: DAY, to: DAY });
    expect(mov.csv).toContain("Fundo de abertura");
    expect(mov.csv).toContain("Sangria");
  });

  it("texto que começa com = vira texto, não fórmula", async () => {
    const { session } = await openSession(env.manager, { registerId: env.registers[6].id, shiftId: env.evening.id, businessDate: "2021-03-21", openingFloatCents: R(100), floatMode: "NEW_OPENING" });
    await createMovement(env.manager, session.id, { type: "DESPESA", amountCents: R(5), paymentMethodId: env.pm("Dinheiro"), description: '=HYPERLINK("http://x")' });
    const out = await buildExport(env.manager, { dataset: "movimentacoes", sessionId: session.id });
    expect(out.csv).toContain(`"'=HYPERLINK(""http://x"")"`);
  });

  it("operador só exporta o caixa dele; auditoria só o administrador", async () => {
    await expect(buildExport(env.operator, { dataset: "vendas", from: DAY, to: DAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(buildExport(env.manager, { dataset: "auditoria", from: DAY, to: DAY })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const audit = await buildExport(env.admin, { dataset: "auditoria" });
    expect(audit.csv).toContain("Valor anterior");
    const { session } = await openSession(env.operator, { registerId: env.registers[1].id, shiftId: env.morning.id, businessDate: todayIso(), openingFloatCents: R(100), floatMode: "NEW_OPENING" });
    const own = await buildExport(env.operator, { dataset: "movimentacoes", sessionId: session.id });
    expect(own.rows).toBe(1); // só o fundo de abertura
    await expect(buildExport(env.operator2, { dataset: "movimentacoes", sessionId: session.id })).resolves.toBeTruthy(); // caixa aberto é de todos os operadores
  });

  it("cada exportação entra na auditoria", async () => {
    const logs = await prisma.auditLog.count({ where: { action: "export.csv" } });
    expect(logs).toBeGreaterThan(5);
  });
});

describe("e-mail: salvar antes, enviar depois, reenviar sem duplicar", () => {
  let server: SMTPServer;
  let port = 0;
  const inbox: ParsedMail[] = [];
  let sessionId: string;

  const start = (p = 0) =>
    new Promise<void>((resolve) => {
      server = new SMTPServer({
        authOptional: true, disabledCommands: ["STARTTLS"],
        onData(stream, _s, cb) {
          simpleParser(stream).then((m) => { inbox.push(m); cb(); });
        },
      });
      server.listen(p, "127.0.0.1", () => { port = (server.server.address() as AddressInfo).port; resolve(); });
    });
  const stop = () => new Promise<void>((r) => server.close(() => r()));

  beforeAll(async () => {
    process.env.EMAIL_PROVIDER = "smtp";
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_SECURE = "false";
    process.env.APP_URL = "https://caixa.exemplo.com.br";
    await start();
    process.env.SMTP_PORT = String(port);
    sessionId = (await closedSession({
      register: 7, shift: "morning", date: "2021-04-01",
      sales: [{ kind: "Dinheiro", cents: R(900) }, { kind: "Cartão de crédito", cents: R(2000) }], note: "Sem ocorrências",
    })).id;
  });
  afterAll(async () => { await stop().catch(() => undefined); });

  it("não envia caixa aberto", async () => {
    const { session } = await openSession(env.manager, { registerId: env.registers[8].id, shiftId: env.evening.id, businessDate: "2021-04-02", openingFloatCents: R(100), floatMode: "NEW_OPENING" });
    await expect(sendClosingEmail(env.manager, session.id, "gerente@exemplo.com")).rejects.toThrow(/Feche o caixa/);
  });

  it("exige destinatário e valida e-mails", async () => {
    await expect(sendClosingEmail(env.manager, sessionId, "")).rejects.toThrow(/Nenhum destinatário/);
    await expect(sendClosingEmail(env.manager, sessionId, "isto-nao-e-email")).rejects.toThrow(/inválido/);
  });

  it("envia com o conteúdo pedido e o relatório completo em anexo", async () => {
    const res = await sendClosingEmail(env.manager, sessionId, "gerente@exemplo.com, dono@exemplo.com");
    expect(res).toMatchObject({ ok: true, attempt: 1 });
    expect(inbox).toHaveLength(1);
    const m = inbox[0];
    expect(m.subject).toContain("Fechamento de caixa 01/04/2021 - Manhã");
    expect(m.text).toContain("Faturamento: R$ 2.900,00");
    expect(m.text).toContain("Fundo inicial (não é faturamento): R$ 100,00");
    expect(m.text).toContain("Responsável: Gabriela Gerente");
    expect(m.text).toContain("https://caixa.exemplo.com.br/historico/");
    expect(m.attachments).toHaveLength(1);
    expect(m.attachments[0].filename).toBe("fechamento-2021-04-01-manha.html");
    expect(m.attachments[0].content.toString("utf8")).toContain("Relatório de fechamento de caixa");
    expect(m.to && !Array.isArray(m.to) ? m.to.value.map((v) => v.address) : []).toEqual(["gerente@exemplo.com", "dono@exemplo.com"]);
    const log = await prisma.emailLog.findFirstOrThrow({ where: { sessionId } });
    expect(log.status).toBe("SENT");
  });

  it("se o envio falhar, o fechamento continua salvo e dá para reenviar sem criar outro", async () => {
    await stop();
    const failed = await sendClosingEmail(env.manager, sessionId, "gerente@exemplo.com");
    expect(failed.ok).toBe(false);
    expect(failed.attempt).toBe(2);
    expect(failed.error).toBeTruthy();
    expect(await prisma.cashClosing.count({ where: { sessionId } })).toBe(1);
    expect((await prisma.cashSession.findUniqueOrThrow({ where: { id: sessionId } })).status).toBe("CLOSED");

    await start(port);
    const again = await sendClosingEmail(env.manager, sessionId, "gerente@exemplo.com");
    expect(again).toMatchObject({ ok: true, attempt: 3 });
    expect(await prisma.cashClosing.count({ where: { sessionId } })).toBe(1);
    const statuses = (await prisma.emailLog.findMany({ where: { sessionId }, orderBy: { attempt: "asc" } })).map((l) => l.status);
    expect(statuses).toEqual(["SENT", "FAILED", "SENT"]);
    expect(await prisma.auditLog.count({ where: { sessionId, action: { in: ["email.send", "email.failed"] } } })).toBe(3);
  });

  it("sem provedor configurado o envio falha com aviso claro, sem quebrar o fechamento", async () => {
    process.env.EMAIL_PROVIDER = "none";
    const res = await sendClosingEmail(env.manager, sessionId, "gerente@exemplo.com");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/não configurado/);
    process.env.EMAIL_PROVIDER = "smtp";
  });
});

describe("login, bloqueio e sessão", () => {
  it("entra, valida o token e registra auditoria", async () => {
    const r = await loginWithPassword("joao@teste.local", "Senha12345", { ip: "10.0.0.1" });
    const u = await userFromToken(r.token);
    expect(u).toMatchObject({ name: "João Operador", role: "OPERATOR" });
    expect(await prisma.auditLog.count({ where: { action: "login", userId: u!.userId } })).toBe(1);
    const stored = await prisma.authSession.findFirstOrThrow({ where: { userId: u!.userId } });
    expect(stored.tokenHash).not.toBe(r.token); // só o hash fica no banco
  });

  it("senha errada não revela se o e-mail existe e bloqueia após tentativas", async () => {
    const a = await loginWithPassword("ninguem@teste.local", "x", {}).catch((e) => e.message);
    const b = await loginWithPassword("maria@teste.local", "errada", {}).catch((e) => e.message);
    expect(a).toBe(b);
    for (let i = 0; i < MAX_FAILED_LOGINS; i++) await loginWithPassword("maria@teste.local", "errada", {}).catch(() => undefined);
    await expect(loginWithPassword("maria@teste.local", "Senha12345", {})).rejects.toThrow(/bloqueado/);
    expect(await prisma.auditLog.count({ where: { action: "login.failed" } })).toBeGreaterThan(MAX_FAILED_LOGINS);
  });

  it("usuário desativado perde o acesso na hora", async () => {
    const r = await loginWithPassword("gabriela@teste.local", "Senha12345", {});
    expect(await userFromToken(r.token)).not.toBeNull();
    await prisma.user.update({ where: { id: env.manager.userId }, data: { active: false } });
    expect(await userFromToken(r.token)).toBeNull();
    await prisma.user.update({ where: { id: env.manager.userId }, data: { active: true } });
  });

  it("sessão expirada é recusada", async () => {
    const r = await loginWithPassword("joao@teste.local", "Senha12345", {});
    await prisma.authSession.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await userFromToken(r.token)).toBeNull();
  });

  it("troca de senha exige a atual e uma senha forte", async () => {
    await expect(changeOwnPassword(env.operator, "errada", "NovaSenha123")).rejects.toThrow(/atual/);
    await expect(changeOwnPassword(env.operator, "Senha12345", "curta")).rejects.toThrow();
    await changeOwnPassword(env.operator, "Senha12345", "NovaSenha123");
    await expect(loginWithPassword("joao@teste.local", "Senha12345", {})).rejects.toThrow();
    await expect(loginWithPassword("joao@teste.local", "NovaSenha123", {})).resolves.toBeTruthy();
  });
});

describe("administração", () => {
  it("só o administrador cria usuários; e-mail duplicado é recusado", async () => {
    await expect(createUser(env.manager, { name: "X Y", email: "x@y.com", role: "OPERATOR", password: "Senha12345" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    const u = await createUser(env.admin, { name: "Novo Operador", email: "NOVO@teste.local", role: "OPERATOR", password: "Senha12345" });
    expect(u.email).toBe("novo@teste.local");
    expect(u.mustChangePassword).toBe(true);
    await expect(createUser(env.admin, { name: "Outro", email: "novo@teste.local", role: "OPERATOR", password: "Senha12345" })).rejects.toThrow(/Já existe/);
  });

  it("não deixa o sistema sem administrador nem o admin se rebaixar", async () => {
    await expect(updateUser(env.admin, env.admin.userId, { active: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateUser(env.admin, env.admin.userId, { role: "MANAGER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("forma de pagamento: sem segundo Dinheiro, tipo imutável, Dinheiro não desativa", async () => {
    await expect(savePaymentMethod(env.admin, { name: "Dinheiro 2", kind: "CASH", active: true })).rejects.toThrow(/Já existe a forma Dinheiro/);
    const cash = await prisma.paymentMethod.findFirstOrThrow({ where: { kind: "CASH" } });
    await expect(savePaymentMethod(env.admin, { id: cash.id, name: "Dinheiro", active: false })).rejects.toThrow(/não pode ser desativada/);
    const cheque = await savePaymentMethod(env.admin, { name: "Vale Refeição Extra", kind: "TICKET", active: true });
    await expect(savePaymentMethod(env.admin, { id: cheque.id, name: cheque.name, kind: "PIX", active: true })).rejects.toThrow(/não pode mudar/);
  });

  it("configurações: fundo padrão, tolerância e destinatários com auditoria", async () => {
    const s = await saveSettings(env.admin, {
      defaultOpeningFloatCents: R(150), toleranceCents: R(2), defaultFloatMode: "TRANSFER", closingRecipients: "a@b.com; c@d.com", restaurantName: "Bistrô Teste",
    });
    expect(s).toMatchObject({ defaultOpeningFloatCents: R(150), toleranceCents: R(2), closingRecipients: ["a@b.com", "c@d.com"] });
    const a = await prisma.auditLog.findFirstOrThrow({ where: { action: "settings.update" }, orderBy: { createdAt: "desc" } });
    expect((a.oldValue as any).defaultOpeningFloat).toBe("R$ 100,00");
    expect((a.newValue as any).defaultOpeningFloat).toBe("R$ 150,00");
    await saveSettings(env.admin, { defaultOpeningFloatCents: R(100), toleranceCents: 0, defaultFloatMode: "NEW_OPENING", closingRecipients: "" });
  });

  it("auditoria: lista com filtros para o administrador", async () => {
    const all = await listAudit(env.admin, {});
    expect(all.total).toBeGreaterThan(50);
    const logins = await listAudit(env.admin, { action: "login" });
    expect(logins.rows.every((r) => r.action.startsWith("login"))).toBe(true);
  });
});
