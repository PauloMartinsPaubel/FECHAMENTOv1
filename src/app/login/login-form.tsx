"use client";

import { ActionForm } from "@/components/action-form";
import { loginAction } from "@/app/actions/auth";

export function LoginForm() {
  return (
    <ActionForm action={loginAction} className="space-y-4">
      <div>
        <label className="label" htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" required autoFocus className="input" />
      </div>
      <div>
        <label className="label" htmlFor="password">Senha</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </div>
      <button type="submit" className="btn-primary w-full">Entrar</button>
    </ActionForm>
  );
}
