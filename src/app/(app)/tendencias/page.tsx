import type { Metadata } from "next";
import Link from "next/link";
import { todayIso } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { buildTrend, summarizeTrend, trendRange, type Granularity } from "@/lib/trends";
import { BarChart } from "@/components/bar-chart";
import { PageHeader, Stat } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { buildPeriodReport } from "@/server/services/queries";

export const metadata: Metadata = { title: "Tendências" };

const REVENUE = "#15803d";
const DIVERGENCE = "#c2410c";

/** "R$ 12 mil" no eixo; o valor exato fica na dica e na tabela */
function compact(cents: number): string {
  const v = cents / 100;
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mi`;
  if (v >= 1_000) return `R$ ${(v / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `R$ ${Math.round(v)}`;
}

export default async function TrendsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("reports.view");
  const sp = await searchParams;
  const by: Granularity = sp.por === "mes" ? "mes" : "semana";
  const today = todayIso();
  const range = trendRange(by, today);
  const report = await buildPeriodReport({ ...user, ip: await clientIp() }, range);
  const periods = buildTrend(report.byDay, by, today);
  const s = summarizeTrend(periods);
  const unit = by === "semana" ? "semana" : "mês";
  const tip = (label: string, value: string, sessions: number, partial: boolean) =>
    `${label}${partial ? " (em andamento)" : ""}: ${value} · ${sessions} caixa(s) fechado(s)`;

  return (
    <div className="space-y-6">
      <PageHeader title="Tendências" subtitle={`${by === "semana" ? "Últimas 12 semanas" : "Últimos 12 meses"}, só caixas fechados. O faturamento não inclui o fundo de caixa.`} />

      <div className="flex gap-2" role="group" aria-label="Agrupar por">
        {(["semana", "mes"] as const).map((g) => (
          <Link key={g} href={`/tendencias?por=${g}`} aria-current={by === g ? "page" : undefined}
            className={by === g ? "btn-primary" : "btn-secondary"}>
            Por {g === "semana" ? "semana" : "mês"}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label={`Média por ${unit}`} value={formatBRL(s.averageCents)} hint={unit === "semana" ? "Semanas completas com caixa fechado" : "Meses completos com caixa fechado"} />
        <Stat label={`Melhor ${unit}`} value={s.best ? formatBRL(s.best.revenueCents) : "-"} hint={s.best?.longLabel} />
        <Stat
          label={unit === "semana" ? "Última semana completa" : "Último mês completo"}
          value={s.lastComplete ? formatBRL(s.lastComplete.revenueCents) : "-"}
          hint={s.changePct === null ? "Sem base de comparação" : `${s.changePct > 0 ? "+" : ""}${s.changePct.toLocaleString("pt-BR")}% sobre o anterior`}
          tone={s.changePct === null ? "default" : s.changePct >= 0 ? "good" : "warn"}
        />
        <Stat label="Soma das diferenças" value={formatBRL(s.divergenceAbsCents)} hint="Em todos os caixas do período" tone={s.divergenceAbsCents > 0 ? "warn" : "good"} />
      </div>

      <section className="card">
        <h2 className="card-title">Faturamento por {unit}</h2>
        <BarChart
          ariaLabel={`Faturamento por ${unit}`}
          color={REVENUE}
          format={compact}
          axisFormat={compact}
          data={periods.map((p) => ({ key: p.key, label: p.label, value: p.revenueCents, partial: p.partial, tooltip: tip(p.longLabel, formatBRL(p.revenueCents), p.sessions, p.partial) }))}
        />
        <p className="mt-1 text-xs text-stone-500">Barra hachurada: {unit} em andamento. Passe o mouse (ou toque) numa barra para ver o valor exato.</p>
      </section>

      <section className="card">
        <h2 className="card-title">Soma das diferenças de caixa por {unit}</h2>
        <BarChart
          ariaLabel={`Soma das diferenças por ${unit}`}
          color={DIVERGENCE}
          format={formatBRL}
          axisFormat={compact}
          height={180}
          data={periods.map((p) => ({ key: p.key, label: p.label, value: p.divergenceAbsCents, partial: p.partial, tooltip: tip(p.longLabel, `${formatBRL(p.divergenceAbsCents)} em diferenças (líquido ${formatBRL(p.divergenceNetCents)})`, p.sessions, p.partial) }))}
        />
        <p className="mt-1 text-xs text-stone-500">Falta e sobra somadas sem sinal: mostra quanto o caixa errou, não se sobrou ou faltou. O detalhe por caixa está em <Link className="link" href="/divergencias">Divergências</Link>.</p>
      </section>

      <section>
        <h2 className="card-title">Tabela</h2>
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-stone-50">
              <tr>
                <th className="th">{by === "semana" ? "Semana" : "Mês"}</th>
                <th className="th text-right">Faturamento</th>
                <th className="th text-right">Dinheiro</th>
                <th className="th text-right">Cartões</th>
                <th className="th text-right">PIX</th>
                <th className="th text-right">Tickets</th>
                <th className="th text-right">Online</th>
                <th className="th text-right">Diferenças</th>
                <th className="th text-right">Caixas</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {[...periods].reverse().map((p) => (
                <tr key={p.key} className={p.partial ? "text-stone-500" : ""}>
                  <td className="td">
                    <Link className="link" href={`/relatorios?from=${p.from}&to=${p.to < today ? p.to : today}`}>{p.longLabel}</Link>
                    {p.partial ? <span className="ml-1 text-xs">(em andamento)</span> : null}
                  </td>
                  <td className="td num font-semibold">{formatBRL(p.revenueCents)}</td>
                  <td className="td num">{formatBRL(p.cashCents)}</td>
                  <td className="td num">{formatBRL(p.cardsCents)}</td>
                  <td className="td num">{formatBRL(p.pixCents)}</td>
                  <td className="td num">{formatBRL(p.ticketsCents)}</td>
                  <td className="td num">{formatBRL(p.onlineCents)}</td>
                  <td className="td num">{formatBRL(p.divergenceAbsCents)}</td>
                  <td className="td num">{p.sessions}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
