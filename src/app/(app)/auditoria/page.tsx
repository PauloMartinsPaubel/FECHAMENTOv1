import type { Metadata } from "next";
import { formatDateTimeBR, isIsoDate } from "@/lib/dates";
import { Empty, PageHeader, Pagination } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { listAudit } from "@/server/services/queries";

export const metadata: Metadata = { title: "Auditoria" };

const ACTION_GROUPS: [string, string][] = [
  ["login", "Login"], ["session", "Abertura, fechamento, reabertura e correção"], ["movement", "Vendas e movimentações"],
  ["cancellation", "Cancelamentos"], ["conference", "Conferência"], ["export", "Exportações"], ["email", "Envio de relatório"],
  ["user", "Usuários"], ["catalog", "Cadastros"], ["settings", "Configurações"],
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requirePermission("audit.view");
  const sp = await searchParams;
  const filters = {
    from: isIsoDate(sp.from) ? sp.from : undefined,
    to: isIsoDate(sp.to) ? sp.to : undefined,
    userId: sp.userId || undefined,
    action: sp.action || undefined,
    sessionId: sp.sessionId || undefined,
    page: Number(sp.page) || 1,
  };
  void (await clientIp());
  const [users, result] = await Promise.all([
    prisma.user.findMany({ where: { restaurantId: user.restaurantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    listAudit(user, filters),
  ]);
  const exportQs = new URLSearchParams(Object.entries({ from: filters.from, to: filters.to, userId: filters.userId, action: filters.action, sessionId: filters.sessionId }).filter(([, v]) => v) as [string, string][]);

  return (
    <div>
      <PageHeader title="Auditoria" subtitle={`${result.total} registro(s). Somente inserção: nada aqui pode ser alterado ou apagado.`} actions={<a className="btn-secondary" href={`/api/export/auditoria?${exportQs.toString()}`}>Exportar CSV</a>} />
      <form method="get" className="card no-print mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div><label className="label" htmlFor="from">De</label><input id="from" name="from" type="date" defaultValue={filters.from} className="input" /></div>
        <div><label className="label" htmlFor="to">Até</label><input id="to" name="to" type="date" defaultValue={filters.to} className="input" /></div>
        <div><label className="label" htmlFor="userId">Usuário</label><select id="userId" name="userId" defaultValue={filters.userId ?? ""} className="input"><option value="">Todos</option>{users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
        <div><label className="label" htmlFor="action">Ação</label><select id="action" name="action" defaultValue={filters.action ?? ""} className="input"><option value="">Todas</option>{ACTION_GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div className="flex items-end"><button className="btn-primary w-full" type="submit">Filtrar</button></div>
      </form>
      {result.rows.length === 0 ? <Empty>Nenhum registro.</Empty> : (
        <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
          <table className="w-full min-w-[800px] text-sm">
            <thead className="bg-stone-50"><tr><th className="th">Quando</th><th className="th">Usuário</th><th className="th">Ação</th><th className="th">Registro</th><th className="th">Antes e depois</th><th className="th">Motivo</th><th className="th">IP</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {result.rows.map((l) => (
                <tr key={l.id}>
                  <td className="td whitespace-nowrap text-xs">{formatDateTimeBR(l.createdAt)}</td>
                  <td className="td">{l.userName ?? <span className="text-stone-400">-</span>}</td>
                  <td className="td font-mono text-xs">{l.action}</td>
                  <td className="td text-xs">{l.entity ?? ""}{l.sessionId ? <a className="link ml-1" href={`/caixa/${l.sessionId}/fechamento`}>caixa</a> : null}</td>
                  <td className="td text-xs">
                    {l.oldValue || l.newValue ? (
                      <details>
                        <summary className="cursor-pointer text-brand-700">ver</summary>
                        {l.oldValue ? <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap rounded bg-red-50 p-2">{JSON.stringify(l.oldValue, null, 1)}</pre> : null}
                        {l.newValue ? <pre className="mt-1 max-w-xs overflow-x-auto whitespace-pre-wrap rounded bg-green-50 p-2">{JSON.stringify(l.newValue, null, 1)}</pre> : null}
                      </details>
                    ) : null}
                  </td>
                  <td className="td">{l.reason ?? ""}</td>
                  <td className="td text-xs text-stone-500">{l.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={result.page} pages={result.pages} basePath="/auditoria" params={{ from: filters.from, to: filters.to, userId: filters.userId, action: filters.action, sessionId: filters.sessionId }} />
    </div>
  );
}
