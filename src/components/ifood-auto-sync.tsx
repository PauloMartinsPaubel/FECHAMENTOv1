"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { autoSyncIfoodAction } from "@/app/actions/integrations";

/** Ao abrir a tela, busca os pedidos do iFood (no máximo 1 vez por minuto) e atualiza a tela se algo mudou. */
export function IfoodAutoSync() {
  const router = useRouter();
  useEffect(() => {
    let alive = true;
    autoSyncIfoodAction()
      .then((r) => {
        if (alive && r.changed) router.refresh();
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [router]);
  return null;
}
