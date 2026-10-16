"use client";

import { useActionState, useState } from "react";
import { ActionForm } from "@/components/action-form";
import { generateEcleticaTokenAction, setEcleticaEnabledAction, type EcleticaKeyState } from "@/app/actions/integrations";

/** Gera (ou troca) a chave do programa. A chave aparece aqui uma vez só, para colar na configuração do programa. */
export function EcleticaKeyForm({ hasKey }: { hasKey: boolean }) {
  const [state, action, pending] = useActionState<EcleticaKeyState, FormData>(generateEcleticaTokenAction, null);
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-3">
      {state?.token ? (
        <div className="space-y-2 rounded-lg border-2 border-amber-400 bg-amber-50 p-3">
          <p className="text-sm font-semibold text-amber-900">Copie a chave agora. Ela não aparece de novo.</p>
          <p className="select-all break-all rounded bg-white p-2 font-mono text-sm">{state.token}</p>
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => navigator.clipboard?.writeText(state.token!).then(() => setCopied(true)).catch(() => undefined)}
          >
            {copied ? "Copiada" : "Copiar chave"}
          </button>
          <p className="text-xs text-amber-900">Cole no campo &quot;chave&quot; do arquivo de configuração do programa, no computador do restaurante. Não mande por e-mail nem por mensagem.</p>
        </div>
      ) : null}
      {state?.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      <form action={action} onSubmit={(e) => { if (hasKey && !confirm("Gerar uma chave nova desliga a anterior. O programa do restaurante para de enviar até receber a chave nova. Continuar?")) e.preventDefault(); }}>
        <button type="submit" className={hasKey ? "btn-secondary" : "btn-primary"} disabled={pending}>
          {hasKey ? "Gerar chave nova" : "Gerar chave do programa"}
        </button>
      </form>
    </div>
  );
}

export function EcleticaEnabledForm({ enabled }: { enabled: boolean }) {
  return (
    <ActionForm action={setEcleticaEnabledAction} hidden={{ enabled: enabled ? "" : "on" }} className="inline">
      <button type="submit" className="btn-secondary btn-sm">{enabled ? "Desligar recebimento" : "Ligar recebimento"}</button>
    </ActionForm>
  );
}
