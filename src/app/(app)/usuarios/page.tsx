import type { Metadata } from "next";
import { formatDateTimeBR } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/permissions";
import { Badge, PageHeader } from "@/components/ui";
import { clientIp, requirePermission } from "@/server/auth/current";
import { listUsers } from "@/server/services/admin";
import { CreateUserForm, UserRow } from "./user-forms";

export const metadata: Metadata = { title: "Usuários" };

export default async function UsersPage() {
  const user = await requirePermission("users.manage");
  const users = await listUsers({ ...user, ip: await clientIp() });
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
    </div>
  );
}
