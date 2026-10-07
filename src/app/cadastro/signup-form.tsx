"use client";

import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { signupAction } from "@/app/actions/signup";

export function SignupForm() {
  return (
    <ActionForm action={signupAction} className="space-y-4" showSuccess={false}>
      <Field label="Código de convite" htmlFor="inviteCode" hint="Recebido de quem te indicou o sistema.">
        <input id="inviteCode" name="inviteCode" required autoComplete="off" className="input" />
      </Field>
      <Field label="Nome do restaurante" htmlFor="restaurantName">
        <input id="restaurantName" name="restaurantName" required minLength={2} maxLength={100} className="input" autoComplete="organization" />
      </Field>
      <Field label="Seu nome" htmlFor="adminName">
        <input id="adminName" name="adminName" required minLength={2} maxLength={100} className="input" autoComplete="name" />
      </Field>
      <Field label="Seu e-mail" htmlFor="email" hint="É com ele que você entra no sistema.">
        <input id="email" name="email" type="email" required className="input" autoComplete="email" />
      </Field>
      <Field label="Senha" htmlFor="password" hint="Ao menos 8 caracteres, com letras e números.">
        <input id="password" name="password" type="password" required minLength={8} className="input" autoComplete="new-password" />
      </Field>
      <Field label="Confirme a senha" htmlFor="passwordConfirm">
        <input id="passwordConfirm" name="passwordConfirm" type="password" required minLength={8} className="input" autoComplete="new-password" />
      </Field>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="acceptTerms" required className="mt-1" />
        <span>
          Li e aceito os <Link href="/termos" target="_blank" className="link">Termos de Uso</Link> e a{" "}
          <Link href="/privacidade" target="_blank" className="link">Política de Privacidade</Link>.
        </span>
      </label>
      <button type="submit" className="btn-primary w-full">Criar restaurante</button>
      <p className="text-xs text-stone-500">
        O restaurante já começa com turnos Manhã e Tarde/Noite, um caixa, os canais e formas de pagamento mais comuns e fundo de caixa de R$ 100,00. Dá para mudar tudo depois em Configurações.
      </p>
    </ActionForm>
  );
}
