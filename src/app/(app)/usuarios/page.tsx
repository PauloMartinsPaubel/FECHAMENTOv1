import type { Metadata } from "next";
import { formatDateTimeBR } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/permissions";
import { Badge, PageHeader } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { listUsers } from "@/server/services/admin";
import { listGrantedAccess } from "@/server/services/units";
import { CreateUserForm, UserRow } from "./user-forms";
import { GrantAccessForm, RevokeAccessButton } from "./access-forms";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsersPage() {
  const user = await requirePermission("users.manage");
  const actor = { ...user, ip: await clientIp() };
  const [users, granted] = await Promise.all([listUsers(actor), listGrantedAccess(actor)]);
  return (
    <div className="space-y-6">
      <PageHeader title="Usuários" subtitle="Operador lança e fecha. Gerente confere, reabre e corrige. Administrador configura tudo." />
      <section className="card">
        <h2 className="card-title">Novo usuário</h2>
        <CreateUserForm />
      </section>
      <section>
        <h2 className="card-title">Usuários ({users.length})</h2>
        <ul className="space-y-3">
          {users.map((u) => (
            <li key={u.id} className="card">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><strong>{u.name}</strong> <span className="text-sm text-stone-600">{u.email}</span></div>
                <div className="flex items-center gap-2 text-xs text-stone-500">
                  {u.active ? <Badge kind="CORRETO">Ativo</Badge> : <Badge kind="CLOSED">Desativado</Badge>}
                  {u.mustChangePassword ? <Badge kind="REOPENED">Troca de senha pendente</Badge> : null}
                  {u.lastLoginAt ? `último acesso ${formatDateTimeBR(u.lastLoginAt)}` : "nunca entrou"}
                </div>
              </div>
              <UserRow user={{ id: u.id, name: u.name, role: u.role.code, active: u.active }} isSelf={u.id === user.userId} roleLabels={ROLE_LABEL} />
            </li>
          ))}
        </ul>
      </section>
      <section className="card">
        <h2 className="card-title">Acesso de outras unidades</h2>
        <p className="mb-3 text-sm text-stone-600">Para quem já tem login em outra unidade (um sócio ou gerente que cuida de mais de uma casa). A pessoa usa o mesmo login e troca de unidade no topo da tela.</p>
        <GrantAccessForm />
        {granted.length > 0 ? (
          <ul className="mt-4 divide-y divide-stone-200">
            {granted.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span><strong>{g.user.name}</strong> {g.user.email} <span className="text-stone-500">({ROLE_LABEL[g.role.code as keyof typeof ROLE_LABEL]}, da unidade {g.user.restaurant.name})</span></span>
                {g.userId === user.userId ? <span className="text-xs text-stone-500">você</span> : <RevokeAccessButton membershipId={g.id} />}
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}
