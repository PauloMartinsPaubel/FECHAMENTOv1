import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { signupOpen } from "@/server/services/signup";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Entrar" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ senha?: string }> }) {
  if (await getCurrentUser()) redirect("/");
  const { senha } = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">R$</div>
          <h1 className="text-2xl font-bold tracking-tight">Fechamento de Caixa</h1>
          <p className="mt-1 text-sm text-stone-600">Entre com seu e-mail e senha</p>
        </div>
        {senha ? (
          <p role="status" className="mb-4 rounded-lg border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-900">Senha nova salva. Entre com ela.</p>
        ) : null}
        <div className="card">
          <LoginForm />
          <p className="mt-4 text-center text-sm"><Link href="/senha/esqueci" className="link">Esqueci minha senha</Link></p>
        </div>
        {signupOpen() ? (
          <p className="mt-4 text-center text-sm text-stone-600">
            Restaurante novo? <Link href="/cadastro" className="link">Cadastre aqui</Link>
          </p>
        ) : null}
        <p className="mt-6 text-center text-xs text-stone-500">
          <Link href="/termos" className="hover:underline">Termos de Uso</Link> · <Link href="/privacidade" className="hover:underline">Privacidade</Link>
        </p>
      </div>
    </main>
  );
}
