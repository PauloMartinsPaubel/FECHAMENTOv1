import type { Metadata } from "next";
import Link from "next/link";
import { formatDateBR, fromDbDate, isIsoDate } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { statusShort } from "@/lib/reports/labels";
import { Badge, Diff, Empty, PageHeader, Pagination } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { loadCatalogRows } from "@/server/loaders";
import { listClosings } from "@/server/services/queries";

export const metadata: Metadata = { title: "Histórico de fechamentos" };
type SP = Record<string, string | undefined>;

export default async function HistoryPage({ searchParams }: { searchParams: Promise<SP> }) {
  const user = await requirePermission("history.view");
  const sp = await searchParams;
  const status = ["CORRETO", "FALTA", "SOBRA", "MISTO"].includes(sp.status ?? "") ? (sp.status as "CORRETO") : undefined;
  const filters = {
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
    shiftId: sp.shiftId || undefined,
    registerId: sp.registerId || undefined,
    status,
    page: Number(sp.page) || 1,
  };
  void (await clientIp());
  const [catalog, result] = await Promise.all([loadCatalogRows(prisma, user.restaurantId), listClosings(user, filters)]);

  return (
    <div>
      <PageHeader title="Histórico de fechamentos" subtitle={`${result.total} fechamento(s)`} />
      <form method="get" className="card no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        <div><label className="label" htmlFor="from">De</label><input id="from" name="from" type="date" defaultValue={filters.from} className="input" /></div>
        <div><label className="label" htmlFor="to">Até</label><input id="to" name="to" type="date" defaultValue={filters.to} className="input" /></div>
        <div><label className="label" htmlFor="shiftId">Turno</label><select id="shiftId" name="shiftId" defaultValue={filters.shiftId ?? ""} className="input"><option value="">Todos</option>{catalog.shifts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="registerId">Caixa</label><select id="registerId" name="registerId" defaultValue={filters.registerId ?? ""} className="input"><option value="">Todos</option>{catalog.registers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></div>
        <div><label className="label" htmlFor="status">Resultado</label><select id="status" name="status" defaultValue={status ?? ""} className="input"><option value="">Todos</option><option value="CORRETO">Correto</option><option value="FALTA">Falta</option><option value="SOBRA">Sobra</option><option value="MISTO">Falta e sobra</option></select></div>
        <div className="flex items-end"><button type="submit" className="btn-primary w-full">Filtrar</button></div>
      </form>

      {result.rows.length === 0 ? (
        <Empty>Nenhum fechamento encontrado.</Empty>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-stone-50"><tr><th className="th">Data</th><th className="th">Turno</th><th className="th">Caixa</th><th className="th text-right">Faturamento</th><th className="th">Resultado</th><th className="th">Fechado por</th><th className="th">E-mail</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {result.rows.map((c) => {
                const mail = c.emailLogs[0];
                return (
                  <tr key={c.id}>
                    <td className="td font-medium">{formatDateBR(fromDbDate(c.session.businessDate))}</td>
                    <td className="td">{c.session.shift.name}</td>
                    <td className="td">{c.session.register.name}</td>
                    <td className="td num font-semibold">{formatBRL(c.revenueCents)}</td>
                    <td className="td">
                      <Badge kind={c.status}>{statusShort(c.status)}</Badge>{" "}
                      {c.totalDiffCents !== 0 || c.absDiffCents !== 0 ? <Diff cents={c.totalDiffCents} /> : null}
                      {c.revision > 1 ? <span className="ml-1 text-xs text-violet-700">corrigido (rev. {c.revision})</span> : null}
                      {c.session.status === "REOPENED" ? <span className="ml-1 text-xs text-amber-700">reaberto</span> : null}
                    </td>
                    <td className="td">{c.closedBy.name}</td>
                    <td className="td">{mail ? <Badge kind={mail.status}>{mail.status === "SENT" ? "Enviado" : "Falhou"}</Badge> : <span className="text-stone-400">-</span>}</td>
                    <td className="td"><Link className="link" href={`/historico/${c.id}`}>Abrir relatório completo</Link></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pages={result.pages} basePath="/historico" params={{ from: filters.from, to: filters.to, shiftId: filters.shiftId, registerId: filters.registerId, status }} />
    </div>
  );
}
