"use client";

import { ActionForm } from "@/components/action-form";
import { syncIfoodAction } from "@/app/actions/integrations";

export function IfoodSyncButton({ sessionId, label = "Buscar pedidos do iFood agora" }: { sessionId?: string; label?: string }) {
  return (
    <ActionForm action={syncIfoodAction} hidden={sessionId ? { sessionId } : undefined}>
      <button type="submit" className="btn-secondary">{label}</button>
    </ActionForm>
  );
}
