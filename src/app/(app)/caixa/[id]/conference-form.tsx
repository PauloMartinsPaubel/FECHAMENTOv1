"use client";

import { useMemo, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { ConfirmSubmit } from "@/components/small-client";
import { conferenceAction } from "@/app/actions/cash";
import { CASH_DENOMINATIONS, type CashCount, formatBRL, formatDecimalComma, formatSigned, KIND_LABEL, parseMoney, type PaymentKind } from "@/lib/finance";
import { statusText } from "@/lib/reports/labels";

export type LineView = {
  key: string;
  group: PaymentKind;
  label: string;
  fullLabel: string;
  systemCents: number;
  expectedCents: number;
  checkedCents: number | null;
  required: boolean;
};

type CashView = {
  floatCents: number;
  salesCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  expensesCents: number;
  refundsCents: number;
  adjustmentsCents: number;
  expectedCents: number;
};

type Section = { id: string; title: string; groups: PaymentKind[] };
const SECTIONS: Section[] = [
  { id: "cash", title: "Dinheiro", groups: ["CASH"] },
  { id: "cards", title: "Cartões", groups: ["CREDIT", "DEBIT"] },
  { id: "pix", title: "PIX", groups: ["PIX"] },
  { id: "tickets", title: "Tickets / Vales", groups: ["TICKET"] },
  { id: "online", title: "Pagamentos online (plataformas)", groups: ["ONLINE"] },
  { id: "other", title: "Outros", groups: ["OTHER"] },
];

const SECTION_HELP: Record<string, string> = {
  cash: "Conte o dinheiro da gaveta, com o fundo dentro.",
  cards: "Informe o total que cada máquina/operadora apresenta.",
  pix: "Informe o total recebido por PIX no extrato.",
  tickets: "Informe o total de cada bandeira na máquina ou no extrato.",
  online: "Informe o valor que o painel de cada plataforma mostra.",
  other: "",
};

const initial = (l: LineView) => (l.checkedCents === null ? "" : formatDecimalComma(l.checkedCents));

export function ConferenceForm({
  sessionId,
  lines,
  cash,
  toleranceCents,
  mode,
  showClose,
  initialJustification,
  initialNotes,
  cashHint,
  initialCashCount = null,
}: {
  sessionId: string;
  lines: LineView[];
  cash: CashView;
  toleranceCents: number;
  mode: "normal" | "correction";
  showClose: boolean;
  initialJustification: string;
  initialNotes: string;
  cashHint?: string;
  /** contagem por cédula e moeda já gravada (null = só o total foi digitado) */
  initialCashCount?: CashCount | null;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(lines.map((l) => [l.key, initial(l)])));
  const [countOn, setCountOn] = useState(initialCashCount !== null);
  const [countFocus, setCountFocus] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(initialCashCount ?? {}).map(([k, q]) => [k, String(q)])),
  );
  const countTotal = Object.entries(counts).reduce((a, [k, q]) => a + Number(k) * (Number(q) || 0), 0);

  // com a contagem ligada, o dinheiro conferido é sempre a soma dela
  const applyCount = (next: Record<string, string>) => {
    const filled = Object.values(next).some((q) => q !== "");
    const total = Object.entries(next).reduce((a, [k, q]) => a + Number(k) * (Number(q) || 0), 0);
    setValues((v) => ({ ...v, cash: filled ? formatDecimalComma(total) : "" }));
  };
  const setCount = (key: string, raw: string) => {
    const q = raw.replace(/\D/g, "").slice(0, 6);
    const next = { ...counts, [key]: q };
    setCounts(next);
    applyCount(next);
  };
  const toggleCount = () => {
    if (countOn) {
      setCountOn(false);
      return;
    }
    setCountOn(true);
    setCountFocus(true);
    applyCount(counts);
  };
  const [justification, setJustification] = useState(initialJustification);
  const [reason, setReason] = useState("");

  const calc = useMemo(() => {
    const rows = lines.map((l) => {
      const raw = values[l.key] ?? "";
      const checked = raw.trim() === "" ? null : parseMoney(raw);
      const invalid = raw.trim() !== "" && checked === null;
      const diff = checked === null ? null : checked - l.expectedCents;
      return { line: l, checked, invalid, diff, pending: l.required && checked === null };
    });
    const pending = rows.filter((r) => r.pending);
    const invalid = rows.filter((r) => r.invalid);
    const net = rows.reduce((a, r) => a + (r.diff ?? 0), 0);
    const abs = rows.reduce((a, r) => a + Math.abs(r.diff ?? 0), 0);
    const neg = rows.some((r) => (r.diff ?? 0) < 0);
    const pos = rows.some((r) => (r.diff ?? 0) > 0);
    const status = pending.length > 0 || invalid.length > 0 ? null : !neg && !pos ? "CORRETO" : neg && !pos ? "FALTA" : pos && !neg ? "SOBRA" : "MISTO";
    return { rows, pending, invalid, net, abs, status } as const;
  }, [lines, values]);

  const needsJustification = calc.status !== null && calc.abs > toleranceCents;
  const blockedReason =
    calc.invalid.length > 0
      ? "Há valores inválidos."
      : calc.pending.length > 0
        ? `Falta conferir: ${calc.pending.map((r) => r.line.fullLabel).join(", ")}.`
        : needsJustification && justification.trim().length < 5
          ? "Escreva a justificativa da divergência."
          : mode === "correction" && reason.trim().length < 3
            ? "Informe o motivo da correção."
            : null;

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }));
  const rowOf = (key: string) => calc.rows.find((r) => r.line.key === key)!;

  const total = (keys: string[]) => {
    const rs = keys.map(rowOf);
    return {
      system: rs.reduce((a, r) => a + r.line.expectedCents, 0),
      checked: rs.reduce((a, r) => a + (r.checked ?? 0), 0),
      diff: rs.every((r) => r.diff === null && r.line.required) ? null : rs.reduce((a, r) => a + (r.diff ?? 0), 0),
      complete: rs.every((r) => !r.pending),
    };
  };

  const diffText = (d: number | null) =>
    d === null ? <span className="text-stone-400">pendente</span> : <span className={`font-semibold tabular-nums ${d < 0 ? "text-red-700" : d > 0 ? "text-amber-700" : "text-green-700"}`}>{formatSigned(d)}</span>;

  return (
    <ActionForm action={conferenceAction} hidden={{ sessionId }} className="space-y-5" showSuccess>
      {SECTIONS.map((sec) => {
        const secLines = lines.filter((l) => sec.groups.includes(l.group));
        if (secLines.length === 0) return null;
        const t = total(secLines.map((l) => l.key));
        return (
          <section key={sec.id} className="card" aria-labelledby={`sec-${sec.id}`}>
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h2 id={`sec-${sec.id}`} className="text-base font-bold">{sec.title}</h2>
              {SECTION_HELP[sec.id] ? <p className="text-xs text-stone-500">{SECTION_HELP[sec.id]}</p> : null}
            </div>

            {sec.id === "cash" ? (
              <dl className="mb-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 rounded-lg bg-stone-50 p-3 text-sm">
                <dt>Fundo de abertura</dt><dd className="num">{formatBRL(cash.floatCents)}</dd>
                <dt>(+) Vendas em dinheiro</dt><dd className="num">{formatBRL(cash.salesCents)}</dd>
                <dt>(+) Suprimentos</dt><dd className="num">{formatBRL(cash.suppliesCents)}</dd>
                <dt>(-) Sangrias</dt><dd className="num">{formatBRL(-cash.withdrawalsCents)}</dd>
                <dt>(-) Despesas pagas em dinheiro</dt><dd className="num">{formatBRL(-cash.expensesCents)}</dd>
                <dt>(-) Estornos em dinheiro</dt><dd className="num">{formatBRL(-cash.refundsCents)}</dd>
                {cash.adjustmentsCents !== 0 ? (<><dt>(+/-) Ajustes</dt><dd className="num">{formatBRL(cash.adjustmentsCents)}</dd></>) : null}
                <dt className="border-t border-stone-300 pt-1 font-bold">Dinheiro esperado</dt>
                <dd className="num border-t border-stone-300 pt-1 font-bold">{formatBRL(cash.expectedCents)}</dd>
              </dl>
            ) : null}

            <div className="hidden grid-cols-[1fr_8rem_11rem_8rem] gap-3 px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-stone-500 sm:grid">
              <span>Item</span><span className="text-right">Sistema</span><span className="text-right">Conferido</span><span className="text-right">Diferença</span>
            </div>
            <ul className="divide-y divide-stone-100">
              {secLines.map((l) => {
                const r = rowOf(l.key);
                return (
                  <li key={l.key} className="grid items-center gap-x-3 gap-y-1 py-2 sm:grid-cols-[1fr_8rem_11rem_8rem]">
                    <label htmlFor={`line:${l.key}`} className="font-medium">
                      {sec.id === "cards" || sec.id === "tickets" || sec.id === "online" ? l.label : l.fullLabel}
                      {l.group === "CASH" ? <span className="block text-xs font-normal text-stone-500">esperado com o fundo</span> : null}
                    </label>
                    <div className="flex justify-between sm:block sm:text-right"><span className="text-xs text-stone-500 sm:hidden">Sistema</span><span className="tabular-nums">{formatBRL(l.expectedCents)}</span></div>
                    <div className="flex items-center gap-1">
                      <MoneyInput
                        name={`line:${l.key}`}
                        id={`line:${l.key}`}
                        value={values[l.key] ?? ""}
                        onValueChange={(v) => set(l.key, v)}
                        className={`input-money ${r.invalid ? "border-red-500" : ""} ${l.key === "cash" && countOn ? "bg-stone-100" : ""}`}
                        ariaLabel={`Conferido: ${l.fullLabel}`}
                        readOnly={l.key === "cash" && countOn}
                      />
                      {l.group !== "CASH" ? (
                        <button
                          type="button"
                          className="btn-secondary btn-sm shrink-0"
                          title="Usar o valor do sistema (só se a máquina ou o extrato mostra o mesmo valor)"
                          aria-label={`Usar o valor do sistema em ${l.fullLabel}`}
                          onClick={() => set(l.key, formatDecimalComma(l.expectedCents))}
                        >
                          =
                        </button>
                      ) : null}
                    </div>
                    <div className="flex justify-between sm:block sm:text-right"><span className="text-xs text-stone-500 sm:hidden">Diferença</span>{diffText(r.diff)}</div>
                  </li>
                );
              })}
            </ul>

            {secLines.length > 1 || sec.id === "cards" ? (
              <div className="mt-2 grid gap-x-3 border-t-2 border-stone-300 pt-2 font-bold sm:grid-cols-[1fr_8rem_11rem_8rem]">
                <span>Total de {sec.id === "cards" ? "cartões" : sec.id === "tickets" ? "tickets" : sec.title.toLowerCase()}</span>
                <span className="tabular-nums sm:text-right">{formatBRL(t.system)}</span>
                <span className="tabular-nums sm:text-right">{t.complete ? formatBRL(t.checked) : "..."}</span>
                <span className="sm:text-right">{diffText(t.diff)}</span>
              </div>
            ) : null}
            {sec.id === "cash" && secLines.some((l) => l.key === "cash") ? (
              <div className="mt-3 rounded-lg border border-stone-200 p-3">
                <input type="hidden" name="count:mode" value={countOn ? "on" : "off"} />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Contagem por cédula e moeda</div>
                    <p className="text-xs text-stone-500">
                      {countOn ? "Digite quantas peças de cada valor há na gaveta. O sistema soma e preenche o dinheiro conferido." : "Opcional: conte peça por peça e deixe o sistema fazer a soma."}
                    </p>
                  </div>
                  <button type="button" className="btn-secondary btn-sm" onClick={toggleCount} aria-expanded={countOn}>
                    {countOn ? "Digitar só o total" : "Contar cédulas e moedas"}
                  </button>
                </div>
                {countOn ? (
                  <div className="mt-3 space-y-3">
                    <div className="grid gap-4 sm:grid-cols-2">
                      {(["nota", "moeda"] as const).map((kind) => (
                        <fieldset key={kind}>
                          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{kind === "nota" ? "Cédulas" : "Moedas"}</legend>
                          <ul className="space-y-1">
                            {CASH_DENOMINATIONS.filter((d) => d.kind === kind).map((d, i) => {
                              const key = String(d.cents);
                              const q = counts[key] ?? "";
                              return (
                                <li key={key} className="grid grid-cols-[6.5rem_5rem_1fr] items-center gap-2">
                                  <label htmlFor={`count:${key}`} className="text-sm">{d.label}</label>
                                  <input
                                    id={`count:${key}`}
                                    name={`count:${key}`}
                                    inputMode="numeric"
                                    autoComplete="off"
                                    pattern="[0-9]*"
                                    maxLength={6}
                                    placeholder="0"
                                    className="input py-1 text-right tabular-nums"
                                    value={q}
                                    autoFocus={countFocus && kind === "nota" && i === 0}
                                    onFocus={(e) => e.currentTarget.select()}
                                    onChange={(e) => setCount(key, e.target.value)}
                                    aria-label={`Quantidade de ${d.kind === "nota" ? "notas" : "moedas"} de ${d.label}`}
                                  />
                                  <span className="text-right text-sm tabular-nums text-stone-600">{q ? formatBRL(d.cents * (Number(q) || 0)) : ""}</span>
                                </li>
                              );
                            })}
                          </ul>
                        </fieldset>
                      ))}
                    </div>
                    <div className="flex justify-between border-t-2 border-stone-300 pt-2 font-bold">
                      <span>Total contado</span>
                      <span className="tabular-nums">{formatBRL(countTotal)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
            {sec.id === "cash" && cashHint ? <p className="mt-2 text-xs text-stone-500">{cashHint}</p> : null}
          </section>
        );
      })}

      <section className={`card border-2 ${calc.status === "CORRETO" ? "border-green-500" : calc.status === null ? "border-stone-300" : "border-red-400"}`} aria-live="polite">
        <h2 className="card-title">Resultado da conferência</h2>
        <div className="grid gap-2 sm:grid-cols-3">
          <div><div className="text-xs uppercase text-stone-500">Divergência líquida</div><div className="text-2xl">{diffText(calc.pending.length ? null : calc.net)}</div></div>
          <div><div className="text-xs uppercase text-stone-500">Soma das diferenças</div><div className="text-2xl font-semibold tabular-nums">{calc.pending.length ? "..." : formatBRL(calc.abs)}</div></div>
          <div><div className="text-xs uppercase text-stone-500">Situação</div><div className="text-lg font-bold">{statusText(calc.status, calc.net, calc.abs)}</div></div>
        </div>
        {calc.pending.length === 0 && calc.rows.some((r) => (r.diff ?? 0) !== 0) ? (
          <div className="mt-3">
            <div className="text-sm font-semibold">De onde vem a diferença</div>
            <ul className="mt-1 text-sm">
              {calc.rows.filter((r) => (r.diff ?? 0) !== 0).map((r) => (
                <li key={r.line.key} className="flex justify-between border-b border-stone-100 py-1"><span>{r.line.fullLabel}</span>{diffText(r.diff)}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {calc.pending.length > 0 ? <p className="mt-3 text-sm text-stone-600">Falta conferir: {calc.pending.map((r) => r.line.fullLabel).join(", ")}.</p> : null}
      </section>

      {needsJustification ? (
        <section className="card border-amber-300 bg-amber-50">
          <label className="label" htmlFor="justification">Justificativa da divergência (obrigatória)</label>
          <textarea id="justification" name="justification" required minLength={5} maxLength={1000} rows={3} className="input" value={justification} onChange={(e) => setJustification(e.target.value)} placeholder="Ex.: Máquina de cartão apresentou diferença de R$ 50." />
          <p className="mt-1 text-xs text-stone-600">A diferença de {formatBRL(calc.abs)} passa da tolerância de {formatBRL(toleranceCents)}. Fica registrada com seu nome, data e hora.</p>
        </section>
      ) : null}

      <section className="card space-y-3">
        <div>
          <label className="label" htmlFor="notes">Observação (opcional)</label>
          <textarea id="notes" name="notes" maxLength={2000} rows={2} className="input" defaultValue={initialNotes} />
        </div>
        {mode === "correction" ? (
          <div>
            <label className="label" htmlFor="reason">Motivo da correção</label>
            <input id="reason" name="reason" required minLength={3} maxLength={500} className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="O que foi corrigido e por quê" />
          </div>
        ) : null}
        {blockedReason && showClose ? <p className="text-sm text-stone-600">{blockedReason}</p> : null}
        <div className="flex flex-wrap gap-3">
          {/* salvar não exige justificativa nem campos completos: isso só vale para fechar (o servidor confere) */}
          <button type="submit" name="intent" value="check" className="btn-secondary" formNoValidate>Conferir</button>
          {showClose ? (
            <ConfirmSubmit
              name="intent"
              value="close"
              className="btn-primary"
              disabled={blockedReason !== null}
              title={blockedReason ?? undefined}
              message={
                mode === "correction"
                  ? "Fechar o caixa de novo com os valores corrigidos?"
                  : `Fechar o caixa? Depois de fechado, só um gerente consegue reabrir. Situação: ${statusText(calc.status, calc.net, calc.abs)}`
              }
            >
              {mode === "correction" ? "Fechar caixa corrigido" : "Fechar caixa"}
            </ConfirmSubmit>
          ) : null}
        </div>
      </section>
    </ActionForm>
  );
}
