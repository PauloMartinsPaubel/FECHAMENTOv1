"use client";

import { ActionForm } from "@/components/action-form";
import { resetPasswordAction } from "@/app/actions/password-reset";

export function NewPasswordForm({ token }: { token: string }) {
  return (
    <ActionForm action={resetPasswordAction} hidden={{ token }} className="space-y-4">
      <div>
        <label className="label" htmlFor="password">Senha nova</label>
        <input id="password" name="password" type="password" autoComplete="new-password" required minLength={8} autoFocus className="input" />
        <p className="mt-1 text-xs text-stone-500">Mínimo de 8 caracteres, com letras e números.</p>
      </div>
      <div>
        <label className="label" htmlFor="confirm">Repita a senha nova</label>
        <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="input" />
      </div>
      <button type="submit" className="btn-primary w-full">Salvar senha nova</button>
    </ActionForm>
  );
}
