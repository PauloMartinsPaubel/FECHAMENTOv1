import type { SiteStats } from "@/server/services/site-stats";

/** Números da página de apresentação: visitas, cliques e de onde vieram. */
export function SiteStatsCard({ week, month }: { week: SiteStats; month: SiteStats }) {
  const rows: [string, (s: SiteStats) => string][] = [
    ["Visitas", (s) => String(s.views)],
    ["Cliques no WhatsApp", (s) => String(s.whatsapp)],
    ["Cliques no cadastro", (s) => String(s.cadastro)],
    ["Cliques em Entrar", (s) => String(s.entrar)],
    ["Visitas que viraram contato", (s) => (s.conversionPct === null ? "-" : `${s.conversionPct.toLocaleString("pt-BR")}%`)],
  ];
  return (
    <div className="space-y-4">
      <table className="w-full max-w-lg text-sm">
        <thead>
          <tr><th className="th"></th><th className="th num">7 dias</th><th className="th num">30 dias</th></tr>
        </thead>
        <tbody className="divide-y divide-stone-100">
          {rows.map(([label, f]) => (
            <tr key={label}><td className="td">{label}</td><td className="td num">{f(week)}</td><td className="td num">{f(month)}</td></tr>
          ))}
        </tbody>
      </table>
      {month.topSources.length ? (
        <p className="text-sm text-stone-600">
          De onde vieram (30 dias): {month.topSources.map((s) => `${s.source} (${s.views})`).join(", ")}. Visitas sem origem são de quem digitou o endereço ou abriu pelo WhatsApp.
        </p>
      ) : (
        <p className="text-sm text-stone-600">Visitas sem origem são de quem digitou o endereço ou abriu o link pelo WhatsApp.</p>
      )}
    </div>
  );
}
