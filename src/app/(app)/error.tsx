"use client";

import { SupportLinks } from "@/components/support-links";

/** Tela de erro inesperado. O erro já foi registrado no servidor e o suporte avisado. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto max-w-lg space-y-3 text-center">
      <h1 className="text-lg font-bold">Algo deu errado nesta tela</h1>
      <p className="text-sm text-stone-600">
        O erro foi registrado e o suporte foi avisado. Nenhum lançamento salvo antes foi perdido. Tente de novo; se continuar, fale com o suporte
        {error.digest ? <> e informe o código <strong className="font-mono">{error.digest}</strong></> : null}.
      </p>
      <div className="flex justify-center gap-2">
        <button type="button" className="btn-primary" onClick={reset}>Tentar de novo</button>
        <a href="/" className="btn-secondary">Ir para o início</a>
      </div>
      <p className="text-xs text-stone-500"><SupportLinks /></p>
    </div>
  );
}
