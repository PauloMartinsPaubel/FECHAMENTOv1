"use client";

import { ActionForm } from "@/components/action-form";
import { secondStepAction } from "@/app/actions/auth";

export function SecondStepForm() {
  return (
    <ActionForm action={secondStepAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="code">Código</label>
        <input id="code" name="code" required autoFocus autoComplete="one-time-code" inputMode="text" maxLength={12} placeholder="123456" className="input text-center text-2xl tracking-[0.3em]" />
      </div>
      <button type="submit" className="btn-primary w-full">Entrar</button>
    </ActionForm>
  );
}
