"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Field } from "@/components/ui";
import { disableTwoFactorAction, regenerateCodesAction, revokeOthersAction, revokeSessionAction, twoFactorSetupAction, type SetupState } from "@/app/actions/account";

function CodesBox({ codes }: { codes: string[] }) {
  const router = useRouter();
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-semibold text-amber-900">Guarde estes códigos de recuperação agora. Eles não aparecem de novo.</p>
      <p className="text-sm text-amber-900">Cada um entra uma vez, no lugar do código do aplicativo, se você perder o celular. Anote no papel ou num gerenciador de senhas.</p>
      <ul className="grid grid-cols-2 gap-2 font-mono text-base sm:grid-cols-5">
        {codes.map((c) => <li key={c} className="rounded bg-white px-2 py-1 text-center">{c}</li>)}
      </ul>
      <button type="button" className="btn-primary" onClick={() => router.refresh()}>Já guardei os códigos</button>
    </div>
  );
}

export function TwoFactorSetup() {
  const [state, dispatch, pending] = useActionState<SetupState, FormData>(twoFactorSetupAction, { step: "idle" });
  if (state.step === "codes") {
    return (
      <div className="space-y-3">
        <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">Verificação em duas etapas ligada. Do próximo login em diante, o sistema pede o código.</p>
        <CodesBox codes={state.codes} />
      </div>
    );
  }
  if (state.step === "scan") {
    return (
      <form action={dispatch} className="space-y-4">
        <input type="hidden" name="intent" value="confirm" />
        <ol className="list-decimal space-y-1 pl-5 text-sm text-stone-700">
          <li>Instale um aplicativo autenticador no celular, se ainda não tiver (Google Authenticator, por exemplo).</li>
          <li>No aplicativo, toque em adicionar e aponte a câmera para o QR code abaixo.</li>
          <li>Digite o código de 6 dígitos que aparecer no aplicativo.</li>
        </ol>
        <div className="flex flex-wrap items-center gap-6">
          <img src={state.qr} alt="QR code para o aplicativo autenticador" width={220} height={220} className="rounded-lg border border-stone-200 bg-white" />
          <div className="text-sm text-stone-600">
            <p>Não consegue ler o QR? Digite esta chave no aplicativo:</p>
            <p className="mt-1 select-all break-all font-mono text-base text-stone-900">{state.secret.replace(/(.{4})/g, "$1 ").trim()}</p>
          </div>
        </div>
        <Field label="Código do aplicativo" htmlFor="tf-code">
          <input id="tf-code" name="code" required inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="input max-w-40 text-center text-xl tracking-widest" />
        </Field>
        {state.error ? <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p> : null}
        <button type="submit" className="btn-primary" disabled={pending}>Confirmar e ligar</button>
      </form>
    );
  }
  return (
    <form action={dispatch} className="space-y-2">
      <input type="hidden" name="intent" value="start" />
      {state.step === "error" ? <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p> : null}
      <button type="submit" className="btn-primary" disabled={pending}>Ligar verificação em duas etapas</button>
    </form>
  );
}

export function RegenerateCodes() {
  const [state, dispatch, pending] = useActionState(regenerateCodesAction, null);
  if (state?.codes) return <CodesBox codes={state.codes} />;
  return (
    <form action={dispatch} className="flex flex-wrap items-end gap-3">
      <Field label="Código atual do aplicativo" htmlFor="rg-code"><input id="rg-code" name="code" required inputMode="numeric" maxLength={7} className="input max-w-40" /></Field>
      <button type="submit" className="btn-secondary" disabled={pending}>Gerar novos códigos</button>
      {state?.error ? <p role="alert" className="w-full text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}

export function DisableTwoFactorForm() {
  return (
    <ActionForm action={disableTwoFactorAction} className="grid items-end gap-3 sm:grid-cols-3">
      <Field label="Sua senha" htmlFor="dis-pass"><input id="dis-pass" name="password" type="password" required autoComplete="current-password" className="input" /></Field>
      <Field label="Código do aplicativo ou de recuperação" htmlFor="dis-code"><input id="dis-code" name="code" required maxLength={12} className="input" /></Field>
      <button type="submit" className="btn-danger">Desligar</button>
    </ActionForm>
  );
}

export function RevokeSessionButton({ sessionId }: { sessionId: string }) {
  return (
    <ActionForm action={revokeSessionAction} hidden={{ sessionId }} showSuccess={false}>
      <button type="submit" className="btn-secondary btn-sm">Encerrar</button>
    </ActionForm>
  );
}

export function RevokeOthersButton() {
  return (
    <ActionForm action={revokeOthersAction}>
      <button type="submit" className="btn-secondary btn-sm">Encerrar todos os outros</button>
    </ActionForm>
  );
}
