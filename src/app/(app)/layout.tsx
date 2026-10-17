import Link from "next/link";
import { can, ROLE_LABEL, type Permission } from "@/lib/permissions";
import { requireUser } from "@/server/auth/current";
import { logoutAction } from "@/app/actions/auth";
import { getAccessState } from "@/server/services/billing";
import { listAccessibleUnits } from "@/server/services/units";
import { UnitSwitcher } from "@/components/unit-switcher";
import { SupportLinks } from "@/components/support-links";
import { MainNav } from "@/components/main-nav";
import { isPlatformAdmin } from "@/server/services/platform";

export const dynamic = "force-dynamic";

type NavDef = { href: string; label: string; perm?: Permission };

/** O que se usa todo dia fica à vista; o resto vai nos grupos. */
const PRIMARY: NavDef[] = [
  { href: "/", label: "Início" },
  { href: "/caixa", label: "Caixa" },
  { href: "/dia", label: "Dia", perm: "reports.view" },
];
const GROUPS: { label: string; items: NavDef[] }[] = [
  {
    label: "Relatórios",
    items: [
      { href: "/relatorios", label: "Relatório do período", perm: "reports.view" },
      { href: "/tendencias", label: "Tendências", perm: "reports.view" },
      { href: "/historico", label: "Histórico de fechamentos", perm: "history.view" },
      { href: "/divergencias", label: "Divergências", perm: "reports.view" },
      { href: "/cancelamentos", label: "Cancelamentos", perm: "reports.view" },
    ],
  },
  {
    label: "Gestão",
    items: [
      { href: "/integracoes", label: "Integrações", perm: "reports.view" },
      { href: "/usuarios", label: "Usuários", perm: "users.manage" },
      { href: "/configuracoes", label: "Configurações", perm: "settings.manage" },
      { href: "/assinatura", label: "Assinatura", perm: "settings.manage" },
      { href: "/auditoria", label: "Auditoria", perm: "audit.view" },
    ],
  },
];

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser({ allowPasswordChange: true, allowTwoFactorSetup: true });
  const blocked = user.mustChangePassword || user.mustSetupTwoFactor;
  const allowed = (n: NavDef) => !n.perm || can(user.role, n.perm);
  const primary = blocked ? [] : PRIMARY.filter(allowed).map(({ href, label }) => ({ href, label }));
  const platform = !blocked && (await isPlatformAdmin(user).catch(() => false));
  const groups = blocked
    ? []
    : GROUPS.map((g) => ({
        label: g.label,
        items: [...g.items.filter(allowed), ...(g.label === "Gestão" && platform ? [{ href: "/plataforma", label: "Plataforma" }] : [])].map(({ href, label }) => ({ href, label })),
      }));
  const access = await getAccessState(user.restaurantId).catch(() => null);
  const isAdmin = can(user.role, "settings.manage");
  const units = await listAccessibleUnits(user.userId).catch(() => []);
  return (
    <div className="min-h-screen">
      <header className="no-print border-b border-stone-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
          <Link href="/" className="flex items-center gap-2 font-bold">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">R$</span>
            <span>Fechamento de Caixa</span>
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {units.length > 1 && !blocked ? <UnitSwitcher units={units} current={user.restaurantId} /> : null}
            <span className="hidden text-stone-600 sm:inline">
              {user.name} <span className="text-stone-400">({ROLE_LABEL[user.role]})</span>
            </span>
            <Link href="/conta" className="btn-secondary btn-sm whitespace-nowrap" title="Senha, verificação em duas etapas e aparelhos conectados">
              Minha conta
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="btn-secondary btn-sm">Sair</button>
            </form>
          </div>
        </div>
        {primary.length > 0 ? <MainNav primary={primary} groups={groups} /> : null}
      </header>
      {access && access.level !== "full" ? (
        <div role="status" className={`no-print border-b px-4 py-2 text-center text-sm ${access.level === "readonly" ? "border-red-300 bg-red-50 text-red-900" : "border-amber-300 bg-amber-50 text-amber-900"}`}>
          {access.message}{" "}
          {isAdmin ? <Link href="/assinatura" className="font-semibold underline">Ver assinatura</Link> : access.level === "readonly" ? "Fale com o administrador do restaurante." : null}
        </div>
      ) : null}
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
      <footer className="no-print mx-auto max-w-6xl px-4 pb-8 text-xs text-stone-400">
        <Link href="/termos" className="hover:underline">Termos de Uso</Link> · <Link href="/privacidade" className="hover:underline">Privacidade</Link>
        <SupportLinks className="ml-3" />
      </footer>
    </div>
  );
}
