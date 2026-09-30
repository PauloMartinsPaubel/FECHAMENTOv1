import type { Metadata } from "next";
import { requireUser } from "@/server/auth/current";
import { Alert, PageHeader } from "@/components/ui";
import { PasswordForm } from "./password-form";

export const metadata: Metadata = { title: "Trocar senha" };

export default async function PasswordPage() {
  const user = await requireUser({ allowPasswordChange: true });
  return (
    <div className="mx-auto max-w-md">
      <PageHeader title="Trocar senha" />
      {user.mustChangePassword ? <Alert tone="warn">Este é o seu primeiro acesso. Escolha uma senha nova para continuar.</Alert> : null}
      <div className="card">
        <PasswordForm />
      </div>
    </div>
  );
}
