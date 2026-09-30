import type { SessionSummary } from "@/lib/finance";
import { formatBRL } from "@/lib/finance";
import { Stat } from "@/components/ui";

/** Faixa de números do caixa. Faturamento e fundo aparecem separados, cada um com seu nome. */
export function SummaryStrip({ summary: s }: { summary: SessionSummary }) {
  return (
    <section aria-label="Resumo do caixa" className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Faturamento" value={formatBRL(s.revenueCents)} hint="Vendas menos estornos. Sem o fundo." tone="good" />
        <Stat label="Fundo de caixa" value={formatBRL(s.floatCents)} hint="Não é faturamento" />
        <Stat label="Dinheiro esperado na gaveta" value={formatBRL(s.cash.expectedCents)} hint="Fundo + vendas em dinheiro + suprimentos - sangrias - despesas - estornos" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Dinheiro" value={formatBRL(s.byKind.CASH.netCents)} />
        <Stat label="Cartões" value={formatBRL(s.cards.totalCents)} hint={`Créd. ${formatBRL(s.cards.creditCents)} · Déb. ${formatBRL(s.cards.debitCents)}`} />
        <Stat label="PIX" value={formatBRL(s.byKind.PIX.netCents)} />
        <Stat label="Tickets" value={formatBRL(s.byKind.TICKET.netCents)} />
        <Stat label="Online" value={formatBRL(s.byKind.ONLINE.netCents)} />
        <Stat label="Outros" value={formatBRL(s.byKind.OTHER.netCents)} />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sangrias" value={formatBRL(s.withdrawalsCents)} />
        <Stat label="Suprimentos" value={formatBRL(s.suppliesCents)} />
        <Stat label="Despesas" value={formatBRL(s.expensesTotalCents)} />
        <Stat label="Cancelamentos" value={formatBRL(s.cancellationsCents)} hint={`${s.cancellationsCount} pedido(s), fora do faturamento`} />
      </div>
    </section>
  );
}
