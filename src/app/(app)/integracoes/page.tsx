import type { Metadata } from "next";
import { formatDateTimeBR } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { Alert, Badge, Empty, PageHeader } from "@/components/ui";
import { IfoodSyncButton } from "@/components/ifood-sync-button";
import { IfoodAutoSync } from "@/components/ifood-auto-sync";
import { IfoodReportUpload } from "@/components/ifood-report-upload";
import { clientIp, requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { getIfoodIntegration, listRecentPlatformOrders } from "@/server/services/integrations";
import { IfoodSettingsForm } from "./settings-form";

export const metadata: Metadata = { title: "Integrações" };

const STATUS_LABEL: Record<string, string> = {
  PLACED: "Novo", CONFIRMED: "Confirmado", READY: "Pronto", DISPATCHED: "Saiu para entrega", CONCLUDED: "Concluído", CANCELLED: "Cancelado",
};

export default async function IntegrationsPage() {
  const user = await requirePermission("reports.view");
  const actor = { ...user, ip: await clientIp() };
  const [{ row, credentialsConfigured }, orders, channels] = await Promise.all([
    getIfoodIntegration(actor),
    listRecentPlatformOrders(actor),
    prisma.salesChannel.findMany({ where: { restaurantId: user.restaurantId, active: true }, orderBy: { sortOrder: "asc" } }),
  ]);
  const ifoodChannel = channels.find((c) => c.name.toLowerCase() === "ifood");

  return (
    <div className="space-y-6">
      <PageHeader title="Integrações" subtitle="Pedidos que chegam direto das plataformas, para conferir o caixa sem digitar." />

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">iFood</h2>
          {row?.enabled ? <Badge kind="CORRETO">Ligada</Badge> : <Badge kind="CLOSED">Desligada</Badge>}
        </div>
        <Alert tone="info">
          O sistema só <strong>lê</strong> os pedidos do iFood e mostra a comparação na aba Conferência de cada caixa.
          Nada é lançado sozinho no caixa, e o seu gestor de pedidos do iFood continua funcionando como hoje.
          Para trazer os pedidos, exporte no Portal do Parceiro (Pedidos, Exportar; depois Relatórios, Exportações, Baixar)
          e envie o arquivo aqui ou na Conferência do caixa. Pode enviar o mesmo dia mais de uma vez: nada é duplicado.
        </Alert>

        {can(user.role, "settings.manage") ? (
          <IfoodSettingsForm merchantId={row?.merchantId ?? ""} channelId={row?.channelId ?? ifoodChannel?.id ?? channels[0]?.id ?? ""} enabled={row?.enabled ?? false} channels={channels.map((c) => ({ id: c.id, name: c.name }))} credentialsConfigured={credentialsConfigured} />
        ) : (
          <p className="text-sm text-stone-600">Somente o administrador altera esta configuração.</p>
        )}

        <div className="flex flex-wrap items-center gap-3 border-t border-stone-200 pt-4">
          {row?.enabled && credentialsConfigured && row.merchantId && can(user.role, "conference.write") ? <><IfoodAutoSync /><IfoodSyncButton /></> : null}
          {row?.enabled && can(user.role, "conference.write") ? <IfoodReportUpload /> : null}
          <p className="text-sm text-stone-600">
            Última busca: {row?.lastSyncAt ? formatDateTimeBR(row.lastSyncAt) : "nunca"}
            {row?.lastSyncInfo ? <span className={row.lastSyncOk === false ? "text-red-700" : ""}> · {row.lastSyncInfo}</span> : null}
          </p>
        </div>
      </section>

      <section>
        <h2 className="card-title">Últimos pedidos recebidos do iFood</h2>
        {orders.length === 0 ? (
          <Empty>Nenhum pedido recebido ainda.</Empty>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-stone-50"><tr><th className="th">Pedido</th><th className="th">Quando</th><th className="th">Situação</th><th className="th text-right">Total</th><th className="th text-right">Pago no app</th><th className="th text-right">Na entrega</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {orders.map((o) => (
                  <tr key={o.id} className={o.status === "CANCELLED" ? "text-stone-400" : ""}>
                    <td className="td font-medium">{o.displayId ?? o.externalId.slice(0, 8)}</td>
                    <td className="td">{formatDateTimeBR(o.placedAt)}</td>
                    <td className="td"><Badge kind={o.status === "CANCELLED" ? "CANCELLED" : "none"}>{STATUS_LABEL[o.status] ?? o.status}</Badge></td>
                    <td className="td num">{formatBRL(o.totalCents)}</td>
                    <td className="td num">{formatBRL(o.onlineCents)}</td>
                    <td className="td num">{formatBRL(o.offlineCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
