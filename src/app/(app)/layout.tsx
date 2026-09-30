import Link from "next/link";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { requireUser } from "@/server/auth/current";
import { logoutAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

const NAV: { href: string; label: string; perm?: Permission }[] = [
  { href: "/", label: "Início" },
  { href: "/caixa", label: "Caixa" },
  { href: "/dia", label: "Dia", perm: "reports.view" },
  { href: "/relatorios", label: "Relatórios", perm: "reports.view" },
  { href: "/historico", label: "Histórico", perm: "history.view" },
  { href: "/divergencias", label: "Divergências", perm: "reports.view" },
  { href: "/cancelamentos", label: "Cancelamentos", perm: "reports.view" },
  { href: "/auditoria", label: "Auditoria", perm: "audit.view" },
  { href: "/usuarios", label: "Usuários", perm: "users.manage" },
  { href: "/configuracoes", label: "Configurações", perm: "settings.manage" },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowPasswordChange: true });
  const items = user.mustChangePassword ? [] : NAV.filter((n) => !n.perm || can(user.role, n.perm));
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">R$</span>
            <span>Fechamento de Caixa</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-stone-600">
              {user.name} <span className="text-stone-400">({ROLE_LABEL[user.role]})</span>
            </span>
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary btn-sm">Sair</button>
            </form>
          </div>
        </div>
        {items.length > 0 ? (
          <nav aria-label="Principal" className="mx-auto max-w-6xl overflow-x-auto px-4">
            <ul className="flex gap-1 whitespace-nowrap pb-2">
              {items.map((n) => (
                <li key={n.href}>
                  <Link href={n.href} className="inline-block rounded-md px-3 py-2 text-sm font-medium text-stone-700 hover:bg-stone-100">
                    {n.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
