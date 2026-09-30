"use client";

import { useActionState, useEffect, useRef, useState, useTransition, type FormEvent } from "react";
import type { ActionState } from "@/app/actions/types";

function newKey(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
}

type Props = {
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
  children: React.ReactNode | ((state: ActionState) => React.ReactNode);
  className?: string;
  /** limpa os campos quando a ação dá certo */
  resetOnSuccess?: boolean;
  /** envia uma chave única por tela, renovada após o sucesso: impede lançamento duplicado */
  idempotent?: boolean;
  /** campos fixos enviados junto (ids) */
  hidden?: Record<string, string>;
  /** mostra a mensagem de sucesso */
  showSuccess?: boolean;
};

/** Formulário ligado a uma Server Action, com erro/sucesso na tela e proteção contra clique duplo. */
export function ActionForm({ action, children, className, resetOnSuccess, idempotent, hidden, showSuccess = true }: Props) {
  const [state, dispatch, pending] = useActionState(action, null);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const [key, setKey] = useState("");

  useEffect(() => setKey(newKey()), []);
  useEffect(() => {
    if (state?.ok) {
      if (resetOnSuccess) formRef.current?.reset();
      if (idempotent) setKey(newKey());
    }
  }, [state, resetOnSuccess, idempotent]);

  // Envio manual (em vez de <form action>): o React limparia os campos mesmo quando a ação dá erro,
  // e a pessoa perderia o que digitou. Assim só limpamos no sucesso, se o formulário pedir.
  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLElement | null;
    const data = new FormData(e.currentTarget, submitter);
    startTransition(() => dispatch(data));
  }

  return (
    <form ref={formRef} onSubmit={onSubmit} className={className} aria-busy={pending}>
      {hidden ? Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
      {idempotent ? <input type="hidden" name="idempotencyKey" value={key} /> : null}
      <fieldset disabled={pending} className="contents">
        {typeof children === "function" ? children(state) : children}
      </fieldset>
      {state?.error ? (
        <p role="alert" className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">
          {state.error}
        </p>
      ) : null}
      {showSuccess && state?.ok && state.message ? (
        <p role="status" className="mt-3 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
