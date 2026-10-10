"use client";

import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { createUnitAction, grantAccessAction, revokeAccessAction } from "@/app/actions/units";
import { adminResetTwoFactorAction } from "@/app/actions/account";

export function GrantAccessForm() {
  return (
    <ActionForm action={grantAccessAction} resetOnSuccess className="grid items-end gap-3 sm:grid-cols-6">
      <Field label="E-mail de login da pessoa" htmlFor="g-email" className="sm:col-span-3"><input id="g-email" name="email" type="email" required className="input" autoComplete="off" /></Field>
      <Field label="Papel nesta unidade" htmlFor="g-role" className="sm:col-span-2">
        <select id="g-role" name="role" className="input" defaultValue="MANAGER"><option value="OPERATOR">Operador</option><option value="MANAGER">Gerente</option><option value="ADMIN">Administrador</option></select>
      </Field>
      <button type="submit" className="btn-primary">Liberar</button>
    </ActionForm>
  );
}

export function RevokeAccessButton({ membershipId }: { membershipId: string }) {
  return (
    <ActionForm action={revokeAccessAction} hidden={{ membershipId }} showSuccess={false}>
      <button type="submit" className="btn-secondary btn-sm">Remover acesso</button>
    </ActionForm>
  );
}

export function CreateUnitForm() {
  return (
    <ActionForm action={createUnitAction} resetOnSuccess className="flex flex-wrap items-end gap-3">
      <Field label="Nome da nova unidade" htmlFor="unit-name"><input id="unit-name" name="name" required minLength={2} maxLength={100} className="input" /></Field>
      <button type="submit" className="btn-primary">Criar unidade</button>
    </ActionForm>
  );
}

/** Para quem perdeu o celular e os códigos de recuperação. */
export function ResetTwoFactorButton({ userId }: { userId: string }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm font-medium text-brand-700">Desligar a verificação em duas etapas desta pessoa</summary>
      <ActionForm action={adminResetTwoFactorAction} hidden={{ userId }} className="mt-2 flex flex-wrap items-center gap-3">
        <p className="text-sm text-stone-600">Use só se a pessoa perdeu o celular e os códigos de recuperação. Ela sai de todos os aparelhos e entra de novo só com a senha.</p>
        <button type="submit" className="btn-secondary btn-sm">Desligar</button>
      </ActionForm>
    </details>
  );
}
