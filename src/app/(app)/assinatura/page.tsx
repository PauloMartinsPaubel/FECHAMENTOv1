import type { Metadata } from "next";
import { formatDateBR, fromDbDate } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { isPaidStatus } from "@/lib/billing";
import { Alert, Badge, Empty, PageHeader } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { getBillingOverview } from "@/server/services/billing";
import { CancelForm, SubscribeForm, SyncForm } from "./forms";

export const metadata: Metadata = { title: "Assinatura" };

const STATUS: Record<string, string> = {
  PENDING: "Aguardando pagamento",
  OVERDUE: "Vencida",
  RECEIVED: "Paga",
  CONFIRMED: "Paga",
  RECEIVED_IN_CASH: "Paga",
  REFUNDED: "Estornada",
  DELETED: "Cancelada",
};

export default async function BillingPage() {
  const user = await requirePermission("settings.manage");
  const { restaurant: r, payments, access, priceCents, asaasReady } = await getBillingOverview({ ...user, ip: await clientIp() });
  const tone = access.level === "readonly" ? "error" : access.level === "warning" ? "warn" : "ok";

  return (
    <div className="space-y-6">
      <PageHeader title="Assinatura" subtitle="Mensalidade do sistema para este restaurante." />
      <Alert tone={tone}>{access.message}</Alert>

      {r.billingPlan === "EXEMPT" ? null : r.billingPlan === "SUBSCRIBED" ? (
        <section className="card space-y-3">
          <h2 className="card-title">Assinatura ativa</h2>
          <p className="text-sm text-stone-700">
            Mensalidade de <strong>{priceCents ? formatBRL(priceCents) : "-"}</strong>, cobrada pelo Asaas no e-mail <strong>{r.billingEmail}</strong>.
            Cada fatura deixa escolher PIX, boleto ou cartão.
          </p>
          <div className="flex flex-wrap gap-3">
            <SyncForm />
            <CancelForm />
          </div>
        </section>
      ) : (
        <section className="card space-y-3">
          <h2 className="card-title">{r.billingPlan === "CANCELED" ? "Assinar de novo" : "Assinar"}</h2>
          {asaasReady ? (
            <>
              <p className="text-sm text-stone-700">
                Mensalidade de <strong>{formatBRL(priceCents!)}</strong> por restaurante.
                {r.billingPlan === "TRIAL" && r.trialEndsAt ? ` Assinando agora, a primeira cobrança só vence depois do teste grátis (que vai até ${formatDateBR(fromDbDate(r.trialEndsAt))}).` : ""}
                {" "}A fatura chega por e-mail e pode ser paga por PIX, boleto ou cartão.
              </p>
              <SubscribeForm defaultEmail={user.email} />
            </>
          ) : (
            <p className="text-sm text-stone-600">A cobrança ainda não foi ligada no servidor. Fale com o suporte do sistema.</p>
          )}
        </section>
      )}

      <section>
        <h2 className="card-title">Mensalidades</h2>
        {payments.length === 0 ? (
          <Empty>Nenhuma mensalidade ainda.</Empty>
        ) : (
          <ul className="divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
            {payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <strong>Vencimento {formatDateBR(fromDbDate(p.dueDate))}</strong>
                  <div className="text-stone-600">{formatBRL(p.valueCents)}{p.paidAt ? ` · paga em ${formatDateBR(fromDbDate(p.paidAt))}` : ""}</div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge kind={isPaidStatus(p.status) ? "CORRETO" : p.status === "OVERDUE" ? "FALTA" : "none"}>{STATUS[p.status] ?? p.status}</Badge>
                  {!isPaidStatus(p.status) && p.invoiceUrl && p.status !== "DELETED" ? (
                    <a className="btn-primary" href={p.invoiceUrl} target="_blank" rel="noopener noreferrer">Pagar</a>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
