import type { Metadata } from "next";
import Link from "next/link";
import { formatDateTimeBR } from "@/lib/dates";
import { ROLE_LABEL } from "@/lib/permissions";
import { Alert, Badge, PageHeader } from "@/components/ui";
import { clientIp, requireUser } from "@/server/auth/current";
import { listMySessions, twoFactorStatus } from "@/server/services/two-factor";
import { DisableTwoFactorForm, RegenerateCodes, RevokeOthersButton, RevokeSessionButton, TwoFactorSetup } from "./forms";

export const metadata: Metadata = { title: "Minha conta" };
export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser();
  const actor = { ...user, ip: await clientIp() };
  const [tf, sessions] = await Promise.all([twoFactorStatus(user.userId), listMySessions(actor)]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="Minha conta" subtitle={`${user.name} · ${user.email} · ${ROLE_LABEL[user.role]}`} />

      <section className="card">
        <h2 className="card-title">Senha</h2>
        <p className="mb-3 text-sm text-stone-600">Troque a senha quando quiser. Ao trocar, os outros aparelhos conectados saem do sistema.</p>
        <Link href="/conta/senha" className="btn-secondary">Trocar senha</Link>
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title mb-0">Verificação em duas etapas</h2>
          {tf.enabled ? <Badge kind="CORRETO">Ligada</Badge> : <Badge kind="CLOSED">Desligada</Badge>}
        </div>
        {tf.enabled ? (
          <div className="space-y-4">
            <p className="text-sm text-stone-600">
              Ligada desde {tf.enabledAt ? formatDateTimeBR(tf.enabledAt) : "-"}. Além da senha, o login pede o código do aplicativo autenticador.
              Restam <strong>{tf.recoveryLeft}</strong> código(s) de recuperação.
            </p>
            {tf.recoveryLeft <= 3 ? <Alert tone="warn">Poucos códigos de recuperação. Gere novos e guarde em lugar seguro.</Alert> : null}
            <details>
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Gerar novos códigos de recuperação</summary>
              <div className="mt-3"><RegenerateCodes /></div>
            </details>
            <details>
              <summary className="cursor-pointer text-sm font-medium text-red-700">Desligar a verificação em duas etapas</summary>
              <div className="mt-3"><DisableTwoFactorForm /></div>
            </details>
          </div>
        ) : tf.available ? (
          <div className="space-y-3">
            <p className="text-sm text-stone-600">
              Protege a conta mesmo se alguém descobrir a sua senha: além dela, o login pede um código de 6 dígitos que muda a cada 30 segundos,
              gerado por um aplicativo no seu celular (Google Authenticator, Microsoft Authenticator ou outro). Recomendado para administradores e gerentes.
            </p>
            <TwoFactorSetup />
          </div>
        ) : (
          <Alert tone="info">A verificação em duas etapas ainda não está configurada no servidor.</Alert>
        )}
      </section>

      <section className="card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="card-title mb-0">Aparelhos conectados</h2>
          {sessions.length > 1 ? <RevokeOthersButton /> : null}
        </div>
        <p className="mb-3 text-sm text-stone-600">Onde a sua conta está aberta agora. Não reconhece algum? Encerre e troque a senha.</p>
        <ul className="divide-y divide-stone-100">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
              <div>
                <div className="font-medium">{s.device} {s.current ? <span className="ml-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-800">este aparelho</span> : null}</div>
                <div className="text-xs text-stone-500">Entrou em {formatDateTimeBR(s.createdAt)} · último uso {formatDateTimeBR(s.lastSeenAt)} · {s.ip}</div>
              </div>
              {s.current ? null : <RevokeSessionButton sessionId={s.id} />}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
