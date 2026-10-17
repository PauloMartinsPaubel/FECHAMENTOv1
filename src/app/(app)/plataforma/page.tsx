import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { addDays, formatDateBR, todayIso } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { Empty, PageHeader } from "@/components/ui";
import { clientIp, requireUser } from "@/server/auth/current";
import { isPlatformAdmin, listRestaurantsForPlatform } from "@/server/services/platform";
import { priceCentsFromEnv } from "@/server/services/billing";
import { PricingForm, TrialForm } from "./forms";

export const metadata: Metadata = { title: "Plataforma" };

const PLAN: Record<string, string> = { EXEMPT: "Isento", TRIAL: "Teste grátis", SUBSCRIBED: "Assinante", CANCELED: "Cancelado" };
const PAYMENT: Record<string, string> = { PENDING: "aguardando", OVERDUE: "vencida", RECEIVED: "paga", CONFIRMED: "paga", RECEIVED_IN_CASH: "paga", REFUNDED: "estornada", DELETED: "cancelada" };

export default async function PlatformPage() {
  const user = await requireUser();
  const actor = { ...user, ip: await clientIp() };
  // para quem não é dono do sistema, a página nem existe
  if (!(await isPlatformAdmin(actor))) notFound();
  const rows = await listRestaurantsForPlatform(actor);
  const today = todayIso();
  const standard = priceCentsFromEnv();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Plataforma"
        subtitle={`Todos os restaurantes que usam o sistema. Preço padrão: ${standard ? formatBRL(standard) : "não configurado"} por mês. Preço combinado vale só para o restaurante; se ele já assina, o Asaas é atualizado junto.`}
      />
      {rows.length === 0 ? <Empty>Nenhum restaurante ainda.</Empty> : null}
      <ul className="space-y-4">
        {rows.map((r) => {
          const status =
            r.plan === "TRIAL" && r.trialEnd
              ? r.trialEnd >= today
                ? `Teste grátis até ${formatDateBR(r.trialEnd)}`
                : `Teste terminou em ${formatDateBR(r.trialEnd)}`
              : r.plan === "SUBSCRIBED"
                ? `Assinante ${r.cycle === "YEARLY" ? "anual" : "mensal"}`
                : PLAN[r.plan];
          return (
            <li key={r.id} className="card space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-bold">{r.name}</h2>
                  <p className="text-sm text-stone-600">
                    {r.admin ? (
                      <>
                        {r.admin.name} · <a className="link" href={`mailto:${r.admin.email}`}>{r.admin.email}</a>
                      </>
                    ) : (
                      "Sem administrador ativo"
                    )}
                  </p>
                  <p className="text-xs text-stone-500">
                    Cadastrado em {formatDateBR(todayIso(r.createdAt))}
                    {r.lastCashDay ? ` · último caixa em ${formatDateBR(r.lastCashDay)}` : " · nenhum caixa aberto ainda"}
                  </p>
                </div>
                <div className="text-right text-sm">
                  <p className="font-semibold">{status}</p>
                  <p className="text-stone-600">
                    {r.prices.monthly ? `${formatBRL(r.prices.monthly)} por mês` : "sem preço"}
                    {r.prices.annual ? ` · ${formatBRL(r.prices.annual)} por ano` : ""}
                    {r.customPriceCents || r.customAnnualPriceCents ? " (combinado)" : ""}
                  </p>
                  {r.lastPayment ? (
                    <p className="text-xs text-stone-500">
                      Última cobrança: {formatBRL(r.lastPayment.valueCents)}, vence {formatDateBR(r.lastPayment.dueDate)}, {PAYMENT[r.lastPayment.status] ?? r.lastPayment.status}
                    </p>
                  ) : null}
                </div>
              </div>
              {r.plan === "EXEMPT" ? null : (
                <div className="space-y-3 border-t border-stone-200 pt-3">
                  <PricingForm restaurantId={r.id} monthlyCents={r.customPriceCents} annualCents={r.customAnnualPriceCents} standard={standard ? `padrão ${formatBRL(standard)}` : "padrão"} />
                  <p className="text-xs text-stone-500">Deixe em branco para usar o preço padrão. Com mensalidade combinada e sem valor anual, o restaurante só vê o plano mensal.</p>
                  {r.plan === "TRIAL" ? <TrialForm restaurantId={r.id} trialEnd={r.trialEnd} max={addDays(today, 90)} /> : null}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
