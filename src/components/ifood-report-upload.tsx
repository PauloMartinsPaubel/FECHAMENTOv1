"use client";

import { ActionForm } from "@/components/action-form";
import { importIfoodReportAction } from "@/app/actions/integrations";

/** Envio do "Relatório de Pedidos" exportado no Portal do Parceiro (Pedidos > Exportar). */
export function IfoodReportUpload({ sessionId }: { sessionId?: string }) {
  return (
    <ActionForm action={importIfoodReportAction} hidden={sessionId ? { sessionId } : undefined} resetOnSuccess className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        name="report"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        required
        className="text-sm file:mr-2 file:rounded-lg file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm"
      />
      <button type="submit" className="btn-secondary">Importar relatório do iFood</button>
    </ActionForm>
  );
}
