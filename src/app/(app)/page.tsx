import type { Metadata } from "next";
import Link from "next/link";
import { formatDateBR, weekdayBR } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { statusText } from "@/lib/reports/labels";
import { Alert, Badge, Diff, Empty, PageHeader, Stat } from "@/components/ui";
import { clientIp, requireUser } from "@/server/auth/current";
import { dashboardData } from "@/server/services/queries";

export const metadata: Metadata = { title: "Início" };

const KIND_COLORS = [
  ["cashSalesCents", "Dinheiro", "bg-emerald-600"],
  ["cardsCents", "Cartões", "bg-sky-600"],
  ["pixCents", "PIX", "bg-violet-600"],
  ["ticketsCents", "Tickets", "bg-amber-500"],
  ["onlineCents", "Online", "bg-rose-500"],
  ["otherCents", "Outros", "bg-stone-500"],
] as const;

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ negado?: string }> }) {
  const { negado } = await searchParams;
  const user = await requireUser();
  const d = await dashboardData({ ...user, ip: await clientIp() });
  const t = d.dayTotal;
  const maxShift = Math.max(1, ...d.byShift.map((s) => s.headline.revenueCents));

  return (
    <div className="space-y-6">
      {negado ? <Alert tone="warn">Você não tem permissão para abrir essa página.</Alert> : null}
      <PageHeader
        title={`Olá, ${user.name.split(" ")[0]}`}
        subtitle={`${formatDateBR(d.today)} (${weekdayBR(d.today)})`}
        actions={can(user.role, "session.open") ? <Link href="/caixa" className="btn-primary">Abrir ou continuar caixa</Link> : null}
      />

      <section aria-label="Hoje" className="grid grid-cols-2 gap-3 lg:grid-cols-6">
        <div className="col-span-2"><Stat label="Faturamento hoje" value={formatBRL(t.revenueCents)} hint="Sem o fundo de caixa" tone="good" /></div>
        <Stat label="Dinheiro" value={formatBRL(t.cashSalesCents)} />
        <Stat label="Cartões" value={formatBRL(t.cardsCents)} />
        <Stat label="PIX" value={formatBRL(t.pixCents)} />
        <Stat label="Tickets" value={formatBRL(t.ticketsCents)} />
        <Stat label="Online" value={formatBRL(t.onlineCents)} />
        <Stat label="Cancelamentos" value={formatBRL(t.cancellationsCents)} hint={`${t.cancellationsCount} pedido(s)`} />
        <Stat
          label="Divergências"
          value={d.divergencesToday}
          hint={can(user.role, "reports.view") ? `${d.divergentLast7Days} fechamento(s) com diferença nos últimos 7 dias` : "hoje"}
          tone={d.divergencesToday > 0 ? "bad" : "default"}
        />
      </section>

      <section>
        <h2 className="card-title">Caixa atual</h2>
        {d.open.length === 0 ? (
          <Empty>Nenhum caixa aberto agora. {can(user.role, "session.open") ? <Link className="link" href="/caixa">Abrir o caixa</Link> : null}</Empty>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {d.open.map((s) => {
              const sum = s.evaluation.summary;
              const div = s.evaluation.divergence;
              return (
                <article key={s.session.id} className="card">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="text-lg font-bold">{s.session.register.name} · {s.session.shift.name}</h3>
                    <Badge kind={s.session.status}>{s.session.status === "OPEN" ? "Aberto" : "Em correção"}</Badge>
                  </div>
                  <p className="text-sm text-stone-600">Responsável: {s.session.responsible.name}</p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                    <div><dt className="text-xs text-stone-500">Fundo inicial</dt><dd className="font-semibold tabular-nums">{formatBRL(sum.floatCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">Faturamento</dt><dd className="font-semibold tabular-nums">{formatBRL(sum.revenueCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">Dinheiro esperado</dt><dd className="font-semibold tabular-nums">{formatBRL(sum.cash.expectedCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">Cartões</dt><dd className="tabular-nums">{formatBRL(sum.cards.totalCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">PIX</dt><dd className="tabular-nums">{formatBRL(sum.byKind.PIX.netCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">Tickets</dt><dd className="tabular-nums">{formatBRL(sum.byKind.TICKET.netCents)}</dd></div>
                    <div><dt className="text-xs text-stone-500">Cancelamentos</dt><dd className="tabular-nums">{formatBRL(sum.cancellationsCents)}</dd></div>
                    <div className="col-span-1 sm:col-span-2">
                      <dt className="text-xs text-stone-500">Divergência</dt>
                      <dd>{div.status === null ? <span className="text-stone-500">a conferir</span> : <><Diff cents={div.netCents} /> <span className="text-xs text-stone-500">{statusText(div.status, div.netCents, div.absCents)}</span></>}</dd>
                    </div>
                  </dl>
                  <Link href={`/caixa/${s.session.id}`} className="btn-secondary mt-3">Continuar este caixa</Link>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section>
        <h2 className="card-title">Manhã x Tarde/Noite (hoje)</h2>
        {d.byShift.length === 0 ? (
          <Empty>Sem movimento hoje.</Empty>
        ) : (
          <div className="card space-y-5">
            {d.byShift.map((s) => (
              <div key={s.shiftName}>
                <div className="mb-1 flex items-baseline justify-between">
                  <strong>{s.shiftName}</strong>
                  <span className="text-lg font-bold tabular-nums">{formatBRL(s.headline.revenueCents)}</span>
                </div>
                <div className="flex h-5 overflow-hidden rounded bg-stone-100" style={{ width: `${Math.max(4, (s.headline.revenueCents / maxShift) * 100)}%` }} role="img" aria-label={`${s.shiftName}: ${formatBRL(s.headline.revenueCents)}`}>
                  {KIND_COLORS.map(([key, label, color]) => {
                    const v = s.headline[key];
                    if (v <= 0 || s.headline.revenueCents <= 0) return null;
                    return <div key={key} className={color} style={{ width: `${(v / s.headline.revenueCents) * 100}%` }} title={`${label}: ${formatBRL(v)}`} />;
                  })}
                </div>
                <p className="mt-1 text-xs text-stone-600">
                  {KIND_COLORS.filter(([key]) => s.headline[key] > 0).map(([key, label]) => `${label} ${formatBRL(s.headline[key])}`).join(" · ") || "Sem vendas"}
                </p>
              </div>
            ))}
            <div className="flex flex-wrap gap-3 border-t border-stone-100 pt-3 text-xs text-stone-600">
              {KIND_COLORS.map(([key, label, color]) => <span key={key} className="flex items-center gap-1"><span className={`inline-block h-3 w-3 rounded-sm ${color}`} />{label}</span>)}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
