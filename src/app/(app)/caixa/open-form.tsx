"use client";

import { useState } from "react";
import { ActionForm } from "@/components/action-form";
import { MoneyInput } from "@/components/money-input";
import { Field } from "@/components/ui";
import { openSessionAction } from "@/app/actions/cash";

type Candidate = { id: string; registerId: string; date: string; shiftName: string; shiftOrder: number; floatCents: number; usedAsSource: boolean };

export function OpenSessionForm({
  registers,
  shifts,
  today,
  minDate,
  defaultFloat,
  defaultMode,
  candidates,
}: {
  registers: { id: string; name: string }[];
  shifts: { id: string; name: string; order: number }[];
  today: string;
  minDate?: string;
  defaultFloat: string;
  defaultMode: "NEW_OPENING" | "TRANSFER";
  candidates: Candidate[];
}) {
  const [registerId, setRegisterId] = useState(registers[0]?.id ?? "");
  const [shiftId, setShiftId] = useState(shifts[0]?.id ?? "");
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<"NEW_OPENING" | "TRANSFER">(defaultMode);
  const [float, setFloat] = useState(defaultFloat);

  const shift = shifts.find((s) => s.id === shiftId);
  const sources = candidates.filter(
    (c) => c.registerId === registerId && c.date === date && shift && c.shiftOrder < shift.order && !c.usedAsSource,
  );
  const transferPossible = sources.length > 0;
  const effectiveMode = mode === "TRANSFER" && transferPossible ? "TRANSFER" : "NEW_OPENING";

  return (
    <ActionForm action={openSessionAction} className="grid gap-4 sm:grid-cols-2">
      <Field label="Caixa" htmlFor="registerId">
        <select id="registerId" name="registerId" className="input" value={registerId} onChange={(e) => setRegisterId(e.target.value)} required>
          {registers.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
      </Field>
      <Field label="Turno" htmlFor="shiftId">
        <select id="shiftId" name="shiftId" className="input" value={shiftId} onChange={(e) => setShiftId(e.target.value)} required>
          {shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </Field>
      <Field label="Data do caixa" htmlFor="businessDate" hint="A data do negócio, mesmo que o turno passe da meia-noite.">
        <input id="businessDate" name="businessDate" type="date" className="input" value={date} min={minDate} max={today} onChange={(e) => setDate(e.target.value)} required />
      </Field>
      <Field label="Fundo de abertura (R$)" htmlFor="openingFloat" hint="Dinheiro que já está na gaveta. Não é faturamento.">
        <MoneyInput name="openingFloat" defaultValue={defaultFloat} required onValueChange={setFloat} />
      </Field>

      <fieldset className="sm:col-span-2">
        <legend className="label">Como começa este fundo?</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 ${effectiveMode === "NEW_OPENING" ? "border-brand-600 bg-brand-50" : "border-stone-300"}`}>
            <input type="radio" name="floatMode" value="NEW_OPENING" checked={effectiveMode === "NEW_OPENING"} onChange={() => setMode("NEW_OPENING")} className="mt-1" />
            <span><strong className="block text-sm">Nova abertura</strong><span className="text-xs text-stone-600">O turno começa com um fundo novo. Soma no total do dia.</span></span>
          </label>
          <label className={`flex items-start gap-2 rounded-lg border p-3 ${transferPossible ? "cursor-pointer" : "opacity-50"} ${effectiveMode === "TRANSFER" ? "border-brand-600 bg-brand-50" : "border-stone-300"}`}>
            <input type="radio" name="floatMode" value="TRANSFER" disabled={!transferPossible} checked={effectiveMode === "TRANSFER"} onChange={() => setMode("TRANSFER")} className="mt-1" />
            <span>
              <strong className="block text-sm">Transferência de fundo entre turnos</strong>
              <span className="text-xs text-stone-600">
                {transferPossible ? "O mesmo fundo passa do turno anterior. Não soma de novo no total do dia." : "Disponível quando o turno anterior do mesmo caixa e dia já foi fechado."}
              </span>
            </span>
          </label>
        </div>
        {effectiveMode === "TRANSFER" ? (
          <div className="mt-3">
            <Field label="Fundo vindo de" htmlFor="transferredFromId">
              <select id="transferredFromId" name="transferredFromId" className="input" required defaultValue={sources[0]?.id}>
                {sources.map((c) => <option key={c.id} value={c.id}>{c.shiftName} ({c.date})</option>)}
              </select>
            </Field>
          </div>
        ) : null}
      </fieldset>

      <Field label="Observação de abertura (opcional)" htmlFor="note" className="sm:col-span-2">
        <input id="note" name="note" maxLength={200} className="input" />
      </Field>
      <div className="sm:col-span-2">
        <button type="submit" className="btn-primary w-full sm:w-auto" disabled={!registerId || !shiftId || float === ""}>Abrir caixa</button>
      </div>
    </ActionForm>
  );
}
