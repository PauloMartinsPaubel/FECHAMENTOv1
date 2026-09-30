import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">R$</div>
          <h1 className="text-2xl font-bold tracking-tight">Fechamento de Caixa</h1>
          <p className="mt-1 text-sm text-stone-600">Entre com seu e-mail e senha</p>
        </div>
        <div className="card">
          <LoginForm />
        </div>
      </div>
    </main>
  );
}
