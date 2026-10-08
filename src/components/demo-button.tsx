"use client";

import { useState } from "react";
import { switchUnitAction } from "@/app/actions/units";

/** Cria a unidade de demonstração. Leva um ou dois minutos, então mostra o andamento. */
export function DemoButton({ resume = false }: { resume?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; msg?: string; error?: string; unitId?: string }>({ busy: false });
  async function go() {
    setState({ busy: true });
    try {
      const res = await fetch("/api/demonstracao", { method: "POST" });
      const j = await res.json().catch(() => ({ error: "O servidor demorou demais e a resposta se perdeu. Recarregue a página: se a demonstração não estiver completa, o botão continua de onde parou." }));
      if (!res.ok) return setState({ busy: false, error: j.error ?? "Não foi possível criar a demonstração." });
      setState({ busy: false, unitId: j.restaurantId, msg: `Pronto: ${j.closedSessions} caixas fechados em ${j.days} dias e um caixa aberto hoje.` });
    } catch {
      setState({ busy: false, error: "A conexão caiu. Recarregue a página: se a demonstração não estiver completa, o botão continua de onde parou." });
    }
  }
  if (state.unitId) {
    // trocar de unidade recarrega o topo, e o seletor passa a mostrar a demonstração
    return (
      <form action={switchUnitAction} className="space-y-3">
        <p role="status" className="rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">{state.msg} Para voltar ao seu restaurante depois, use o seletor do topo.</p>
        <input type="hidden" name="restaurantId" value={state.unitId} />
        <button type="submit" className="btn-primary">Abrir a demonstração</button>
      </form>
    );
  }
  return (
    <div className="space-y-2">
      <button type="button" className="btn-secondary" onClick={go} disabled={state.busy}>
        {state.busy ? "Gerando a demonstração, pode levar alguns minutos..." : resume ? "Continuar a demonstração" : "Criar unidade de demonstração"}
      </button>
      {state.error ? <p role="alert" className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-900">{state.error}</p> : null}
    </div>
  );
}
