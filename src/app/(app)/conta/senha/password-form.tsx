"use client";

import { ActionForm } from "@/components/action-form";
import { changePasswordAction } from "@/app/actions/auth";

export function PasswordForm() {
  return (
    <ActionForm action={changePasswordAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="current">Senha atual</label>
        <input id="current" name="current" type="password" autoComplete="current-password" required className="input" />
      </div>
      <div>
        <label className="label" htmlFor="next">Nova senha</label>
        <input id="next" name="next" type="password" autoComplete="new-password" required minLength={8} className="input" />
        <p className="mt-1 text-xs text-stone-500">Mínimo de 8 caracteres, com letras e números.</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Repita a nova senha</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
      </div>
      <button type="submit" className="btn-primary w-full">Salvar nova senha</button>
    </ActionForm>
  );
}
