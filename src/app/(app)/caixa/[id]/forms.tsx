"use client";

import { useEffect, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { Field } from "@/components/ui";
import type { ActionState } from "@/app/actions/types";
import type { SaleShortcut } from "@/lib/sale-shortcuts";
import {
  addMovementAction,
  addSaleAction,
  cancelSaleAction,
  registerCancellationAction,
  updateMovementAction,
  voidMovementAction,
} from "@/app/actions/cash";

export type CatalogView = {
  channels: { id: string; name: string }[];
  methods: { id: string; name: string; kind: string }[];
  brands: { id: string; name: string }[];
};

function OnSuccess({ state, run }: { state: ActionState; run: () => void }) {
  useEffect(() => {
    if (state?.ok) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return null;
}

function DuplicateConfirm({ state }: { state: ActionState }) {
  if (state?.code !== "DUPLICATE_SUSPECT") return null;
  return (
    <label className="mt-2 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm">
      <input type="checkbox" name="allowDuplicate" className="mt-0.5" />
      <span>Confirmo que é outro lançamento, e não repetição. Marque e envie de novo.</span>
    </label>
  );
}

function ReasonField({ show, label = "Motivo da correção" }: { show: boolean; label?: string }) {
  if (!show) return null;
  return (
    <Field label={label} htmlFor="reason" className="sm:col-span-2" hint="O caixa foi reaberto: toda alteração fica registrada com o motivo.">
      <input id="reason" name="reason" required minLength={3} maxLength={500} className="input" />
    </Field>
  );
}

function Select({ name, value, onChange, children, required = true, id }: { name: string; value?: string; onChange?: (v: string) => void; children: React.ReactNode; required?: boolean; id?: string }) {
  return (
    <select id={id ?? name} name={name} className="input" required={required} value={value} onChange={onChange ? (e) => onChange(e.target.value) : undefined}>
      {children}
    </select>
  );
}

/**
 * Nova venda: canal, forma, bandeira (só ticket), valor e número do pedido.
 * Lançamento rápido: os atalhos escolhem canal e forma num toque e levam o cursor ao valor; depois de lançar,
 * o cursor volta para o valor com a mesma combinação, para a próxima venda ser só "valor + Enter".
 */
export function SaleForm({
  sessionId,
  catalog,
  correction,
  shortcuts = [],
}: {
  sessionId: string;
  catalog: CatalogView;
  correction: boolean;
  shortcuts?: SaleShortcut[];
}) {
  const start = shortcuts[0];
  const defaultMethod = catalog.methods.find((m) => m.kind === "CASH") ?? catalog.methods[0];
  const [channelId, setChannelId] = useState(start?.channelId ?? catalog.channels[0]?.id ?? "");
  const [methodId, setMethodId] = useState(start?.paymentMethodId ?? defaultMethod?.id ?? "");
  const [brandId, setBrandId] = useState(start?.ticketBrandId ?? "");
  const [n, setN] = useState(0);
  const kind = catalog.methods.find((m) => m.id === methodId)?.kind;

  // foco na hora (sem esperar o próximo quadro), para o primeiro dígito digitado não se perder
  const focusAmount = () => document.getElementById("amount")?.focus();
  const pick = (s: SaleShortcut) => {
    setChannelId(s.channelId);
    setMethodId(s.paymentMethodId);
    setBrandId(s.ticketBrandId ?? "");
    focusAmount();
  };
  const isPicked = (s: SaleShortcut) =>
    s.channelId === channelId && s.paymentMethodId === methodId && (kind !== "TICKET" || (s.ticketBrandId ?? "") === brandId);

  return (
    <ActionForm action={addSaleAction} idempotent hidden={{ sessionId }} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <OnSuccess state={state} run={() => setN((x) => x + 1)} />
          {shortcuts.length > 0 ? (
            <div className="sm:col-span-6">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Lançamento rápido</div>
              <div role="group" aria-label="Atalhos de canal e forma de pagamento" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {shortcuts.map((s) => {
                  const on = isPicked(s);
                  return (
                    <button
                      key={`${s.channelId}:${s.paymentMethodId}:${s.ticketBrandId ?? ""}`}
                      type="button"
                      onClick={() => pick(s)}
                      aria-pressed={on}
                      className={`min-h-12 rounded-lg border px-3 py-2 text-left text-sm font-semibold transition-colors ${
                        on ? "border-green-700 bg-green-700 text-white" : "border-stone-300 bg-white text-stone-800 hover:border-green-700 hover:bg-green-50"
                      }`}
                    >
                      {s.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-stone-500">
                {shortcuts.some((s) => s.uses > 0) ? "As combinações mais lançadas nos últimos 30 dias. " : ""}
                Toque na combinação, digite o valor e aperte Enter.
              </p>
            </div>
          ) : null}
          <Field label="Canal" htmlFor="channelId" className="sm:col-span-2">
            <Select name="channelId" value={channelId} onChange={setChannelId}>
              {catalog.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Forma de pagamento" htmlFor="paymentMethodId" className="sm:col-span-2">
            <Select name="paymentMethodId" value={methodId} onChange={(v) => { setMethodId(v); setBrandId(""); }}>
              {catalog.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          {kind === "TICKET" ? (
            <Field label="Bandeira do ticket" htmlFor="ticketBrandId" className="sm:col-span-2">
              <Select name="ticketBrandId" value={brandId} onChange={setBrandId}>
                <option value="">Escolha...</option>
                {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          ) : (
            <div className="hidden sm:col-span-2 sm:block" />
          )}
          <Field label="Valor (R$)" htmlFor="amount" className="sm:col-span-2">
            <MoneyInput key={`a${n}`} name="amount" required autoFocus={n > 0} />
          </Field>
          <Field label="Nº do pedido (opcional)" htmlFor="orderNumber" className="sm:col-span-2">
            <input key={`o${n}`} id="orderNumber" name="orderNumber" maxLength={40} className="input" autoComplete="off" />
          </Field>
          <Field label="Observação (opcional)" htmlFor="description" className="sm:col-span-2">
            <input key={`d${n}`} id="description" name="description" maxLength={300} className="input" autoComplete="off" />
          </Field>
          <ReasonField show={correction} />
          <div className="sm:col-span-6">
            <DuplicateConfirm state={state} />
            <button type="submit" className="btn-primary mt-2 w-full sm:w-auto">Lançar venda</button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

const OTHER_TYPES = [
  { value: "SANGRIA", label: "Sangria (retirada de dinheiro)" },
  { value: "SUPRIMENTO", label: "Suprimento (entrada de dinheiro)" },
  { value: "DESPESA", label: "Despesa" },
  { value: "ESTORNO", label: "Estorno / devolução" },
  { value: "AJUSTE", label: "Ajuste" },
];

export function MovementForm({ sessionId, catalog, correction }: { sessionId: string; catalog: CatalogView; correction: boolean }) {
  const cash = catalog.methods.find((m) => m.kind === "CASH") ?? catalog.methods[0];
  const [type, setType] = useState("SANGRIA");
  const [methodId, setMethodId] = useState(cash?.id ?? "");
  const [n, setN] = useState(0);
  const kind = catalog.methods.find((m) => m.id === methodId)?.kind;
  const needsMethod = type === "DESPESA" || type === "ESTORNO" || type === "AJUSTE";
  const needsChannel = type === "ESTORNO" || type === "AJUSTE";
  const descLabel: Record<string, string> = {
    SANGRIA: "Destino da sangria",
    SUPRIMENTO: "Origem do suprimento",
    DESPESA: "Descrição da despesa",
    ESTORNO: "Motivo do estorno",
    AJUSTE: "Motivo do ajuste",
  };

  return (
    <ActionForm action={addMovementAction} idempotent hidden={{ sessionId }} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <OnSuccess state={state} run={() => setN((x) => x + 1)} />
          <Field label="Tipo" htmlFor="type" className="sm:col-span-2">
            <Select name="type" value={type} onChange={setType}>
              {OTHER_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Valor (R$)" htmlFor="amount" className="sm:col-span-2">
            <MoneyInput key={`a${n}`} name="amount" required />
          </Field>
          {needsMethod ? (
            <Field label={type === "DESPESA" ? "Paga com" : "Forma de pagamento"} htmlFor="paymentMethodId" className="sm:col-span-2">
              <Select name="paymentMethodId" value={methodId} onChange={setMethodId}>
                {catalog.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </Select>
            </Field>
          ) : <div className="hidden sm:col-span-2 sm:block" />}
          {needsChannel ? (
            <Field label="Canal" htmlFor="channelId" className="sm:col-span-2">
              <Select name="channelId">
                {catalog.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </Field>
          ) : null}
          {needsChannel && kind === "TICKET" ? (
            <Field label="Bandeira do ticket" htmlFor="ticketBrandId" className="sm:col-span-2">
              <Select name="ticketBrandId">
                <option value="">Escolha...</option>
                {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </Select>
            </Field>
          ) : null}
          {type === "ESTORNO" ? (
            <Field label="Nº do pedido" htmlFor="orderNumber" className="sm:col-span-2">
              <input key={`o${n}`} id="orderNumber" name="orderNumber" maxLength={40} className="input" autoComplete="off" />
            </Field>
          ) : null}
          {type === "AJUSTE" ? (
            <fieldset className="grid gap-2 rounded-lg border border-stone-200 p-3 sm:col-span-6 sm:grid-cols-3">
              <legend className="px-1 text-sm font-medium text-stone-700">O ajuste</legend>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="direction" value="+" defaultChecked /> Soma (+)</label>
              <label className="flex items-center gap-2 text-sm"><input type="radio" name="direction" value="-" /> Subtrai (-)</label>
              <span />
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="affectsRevenue" /> Afeta o faturamento</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="affectsCash" /> Afeta o dinheiro da gaveta (use a forma Dinheiro)</label>
            </fieldset>
          ) : null}
          <Field label={descLabel[type]} htmlFor="description" className="sm:col-span-6">
            <input key={`d${n}`} id="description" name="description" required maxLength={300} className="input" autoComplete="off" />
          </Field>
          <ReasonField show={correction} />
          <div className="sm:col-span-6">
            <DuplicateConfirm state={state} />
            <button type="submit" className="btn-primary mt-2 w-full sm:w-auto">Lançar</button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

/** Pedido cancelado que nunca entrou como venda. Só informativo. */
export function CancellationForm({ sessionId, catalog, correction, employeeName }: { sessionId: string; catalog: CatalogView; correction: boolean; employeeName: string }) {
  const [n, setN] = useState(0);
  return (
    <ActionForm action={registerCancellationAction} hidden={{ sessionId }} className="grid gap-3 sm:grid-cols-6">
      {(state) => (
        <>
          <OnSuccess state={state} run={() => setN((x) => x + 1)} />
          <Field label="Nº do pedido" htmlFor="c-orderNumber" className="sm:col-span-2">
            <input key={`o${n}`} id="c-orderNumber" name="orderNumber" required maxLength={40} className="input" autoComplete="off" />
          </Field>
          <Field label="Canal" htmlFor="c-channelId" className="sm:col-span-2">
            <Select id="c-channelId" name="channelId">
              {catalog.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label="Forma de pagamento" htmlFor="c-paymentMethodId" className="sm:col-span-2">
            <Select id="c-paymentMethodId" name="paymentMethodId" required={false}>
              <option value="">Não informada</option>
              {catalog.methods.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
          <Field label="Valor do pedido (R$)" htmlFor="c-amount" className="sm:col-span-2">
            <MoneyInput key={`a${n}`} name="amount" id="c-amount" required />
          </Field>
          <Field label="Funcionário" htmlFor="c-employeeName" className="sm:col-span-2">
            <input id="c-employeeName" name="employeeName" defaultValue={employeeName} maxLength={100} className="input" />
          </Field>
          <Field label="Motivo" htmlFor="c-reason" className="sm:col-span-2">
            <input key={`r${n}`} id="c-reason" name="reason" required minLength={3} maxLength={500} className="input" />
          </Field>
          {correction ? <p className="text-xs text-stone-500 sm:col-span-6">O motivo acima também fica registrado como justificativa da correção.</p> : null}
          <div className="sm:col-span-6">
            <DuplicateConfirm state={state} />
            <button type="submit" className="btn-secondary mt-2">Registrar pedido cancelado</button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export type MovementView = {
  id: string;
  type: string;
  status: string;
  amountCents: number;
  channelId: string | null;
  paymentMethodId: string | null;
  ticketBrandId: string | null;
  orderNumber: string | null;
  description: string | null;
  isAdjustment: boolean;
};

/** Editar, anular ou cancelar um lançamento: três formulários pequenos, abertos sob demanda. */
export function MovementActions({ sessionId, m, catalog, employeeName }: { sessionId: string; m: MovementView; catalog: CatalogView; employeeName: string }) {
  const [open, setOpen] = useState<"edit" | "void" | "cancel" | null>(null);
  const [methodId, setMethodId] = useState(m.paymentMethodId ?? "");
  const kind = catalog.methods.find((x) => x.id === methodId)?.kind;
  const fixedCash = m.type === "SANGRIA" || m.type === "SUPRIMENTO";
  const hasChannel = m.type === "VENDA" || m.type === "ESTORNO" || (m.type === "AJUSTE" && m.channelId !== null);
  const hasMethod = m.type !== "SANGRIA" && m.type !== "SUPRIMENTO";
  const money = (m.amountCents / 100).toFixed(2).replace(".", ",");

  return (
    <div className="mt-2">
      <div className="no-print flex flex-wrap gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(open === "edit" ? null : "edit")}>Corrigir</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(open === "void" ? null : "void")}>Anular</button>
        {m.type === "VENDA" ? <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(open === "cancel" ? null : "cancel")}>Cancelar venda</button> : null}
      </div>

      {open === "edit" ? (
        <ActionForm action={updateMovementAction} hidden={{ sessionId, movementId: m.id }} className="mt-3 grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-6">
          <Field label="Valor (R$)" htmlFor={`e-amount-${m.id}`} className="sm:col-span-2">
            <MoneyInput name="amount" id={`e-amount-${m.id}`} defaultValue={money} required />
          </Field>
          {hasChannel ? (
            <Field label="Canal" htmlFor={`e-ch-${m.id}`} className="sm:col-span-2">
              <select id={`e-ch-${m.id}`} name="channelId" className="input" defaultValue={m.channelId ?? ""}>
                {catalog.channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          ) : null}
          {hasMethod && !fixedCash ? (
            <Field label="Forma de pagamento" htmlFor={`e-pm-${m.id}`} className="sm:col-span-2">
              <select id={`e-pm-${m.id}`} name="paymentMethodId" className="input" value={methodId} onChange={(e) => setMethodId(e.target.value)}>
                {catalog.methods.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </Field>
          ) : null}
          {hasMethod && !fixedCash && kind === "TICKET" ? (
            <Field label="Bandeira" htmlFor={`e-tb-${m.id}`} className="sm:col-span-2">
              <select id={`e-tb-${m.id}`} name="ticketBrandId" className="input" defaultValue={m.ticketBrandId ?? ""} required>
                <option value="">Escolha...</option>
                {catalog.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Nº do pedido" htmlFor={`e-on-${m.id}`} className="sm:col-span-2">
            <input id={`e-on-${m.id}`} name="orderNumber" defaultValue={m.orderNumber ?? ""} maxLength={40} className="input" />
          </Field>
          <Field label="Descrição" htmlFor={`e-ds-${m.id}`} className="sm:col-span-4">
            <input id={`e-ds-${m.id}`} name="description" defaultValue={m.description ?? ""} maxLength={300} className="input" />
          </Field>
          <Field label="Motivo da correção" htmlFor={`e-rs-${m.id}`} className="sm:col-span-6" hint="Fica registrado com o valor anterior, o novo, quem e quando.">
            <input id={`e-rs-${m.id}`} name="reason" required minLength={3} maxLength={500} className="input" />
          </Field>
          <div className="sm:col-span-6"><button type="submit" className="btn-primary btn-sm">Salvar correção</button></div>
        </ActionForm>
      ) : null}

      {open === "void" ? (
        <ActionForm action={voidMovementAction} hidden={{ sessionId, movementId: m.id }} className="mt-3 grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-6">
          <Field label="Por que este lançamento será anulado?" htmlFor={`v-rs-${m.id}`} className="sm:col-span-5" hint="Anular é para lançamento feito por engano. Ele não é apagado: continua guardado e sai das somas.">
            <input id={`v-rs-${m.id}`} name="reason" required minLength={3} maxLength={500} className="input" />
          </Field>
          <div className="flex items-end"><button type="submit" className="btn-danger btn-sm">Anular</button></div>
        </ActionForm>
      ) : null}

      {open === "cancel" ? (
        <ActionForm action={cancelSaleAction} hidden={{ sessionId, movementId: m.id }} className="mt-3 grid gap-3 rounded-lg bg-stone-50 p-3 sm:grid-cols-6">
          <Field label="Motivo do cancelamento" htmlFor={`c-rs-${m.id}`} className="sm:col-span-3" hint="O pedido sai do faturamento e vira registro de cancelamento.">
            <input id={`c-rs-${m.id}`} name="reason" required minLength={3} maxLength={500} className="input" />
          </Field>
          <Field label="Funcionário" htmlFor={`c-em-${m.id}`} className="sm:col-span-2">
            <input id={`c-em-${m.id}`} name="employeeName" defaultValue={employeeName} maxLength={100} className="input" />
          </Field>
          <div className="flex items-end"><button type="submit" className="btn-danger btn-sm">Cancelar venda</button></div>
        </ActionForm>
      ) : null}
    </div>
  );
}
