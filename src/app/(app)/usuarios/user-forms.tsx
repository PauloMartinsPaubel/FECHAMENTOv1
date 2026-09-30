"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { createUserAction, resetPasswordAction, updateUserAction } from "@/app/actions/admin";

const ROLES = ["OPERATOR", "MANAGER", "ADMIN"] as const;

export function CreateUserForm() {
  return (
    <ActionForm action={createUserAction} resetOnSuccess className="grid gap-3 sm:grid-cols-6">
      <Field label="Nome" htmlFor="name" className="sm:col-span-2"><input id="name" name="name" required minLength={2} maxLength={100} className="input" /></Field>
      <Field label="E-mail" htmlFor="email" className="sm:col-span-2"><input id="email" name="email" type="email" required className="input" autoComplete="off" /></Field>
      <Field label="Papel" htmlFor="role" className="sm:col-span-2">
        <select id="role" name="role" className="input" defaultValue="OPERATOR"><option value="OPERATOR">Operador</option><option value="MANAGER">Gerente</option><option value="ADMIN">Administrador</option></select>
      </Field>
      <Field label="Senha inicial" htmlFor="password" className="sm:col-span-3" hint="Mínimo de 8 caracteres, com letras e números. A pessoa troca no primeiro acesso.">
        <input id="password" name="password" type="text" required minLength={8} className="input" autoComplete="off" />
      </Field>
      <div className="flex items-end sm:col-span-3"><button type="submit" className="btn-primary">Criar usuário</button></div>
    </ActionForm>
  );
}

export function UserRow({ user, isSelf, roleLabels }: { user: { id: string; name: string; role: string; active: boolean }; isSelf: boolean; roleLabels: Record<string, string> }) {
  return (
    <div className="space-y-3">
      <ActionForm action={updateUserAction} hidden={{ userId: user.id }} className="grid items-end gap-3 sm:grid-cols-6">
        <Field label="Nome" htmlFor={`n-${user.id}`} className="sm:col-span-2"><input id={`n-${user.id}`} name="name" defaultValue={user.name} required className="input" /></Field>
        <Field label="Papel" htmlFor={`r-${user.id}`} className="sm:col-span-2">
          <select id={`r-${user.id}`} name="role" defaultValue={user.role} className="input" disabled={isSelf}>
            {ROLES.map((r) => <option key={r} value={r}>{roleLabels[r]}</option>)}
          </select>
          {isSelf ? <input type="hidden" name="role" value={user.role} /> : null}
        </Field>
        <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" name="active" defaultChecked={user.active} disabled={isSelf} />{isSelf ? <><input type="hidden" name="active" value="on" />Ativo (você)</> : "Ativo"}</label>
        <button type="submit" className="btn-secondary">Salvar</button>
      </ActionForm>
      <details>
        <summary className="cursor-pointer text-sm font-medium text-brand-700">Redefinir senha</summary>
        <ActionForm action={resetPasswordAction} hidden={{ userId: user.id }} resetOnSuccess className="mt-2 flex flex-wrap items-end gap-3">
          <Field label="Nova senha provisória" htmlFor={`p-${user.id}`}><input id={`p-${user.id}`} name="password" type="text" required minLength={8} className="input" autoComplete="off" /></Field>
          <button type="submit" className="btn-secondary">Redefinir</button>
        </ActionForm>
      </details>
    </div>
  );
}
