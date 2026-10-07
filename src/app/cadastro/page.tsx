import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth/current";
import { signupOpen } from "@/server/services/signup";
import { SignupForm } from "./signup-form";

export const metadata: Metadata = { title: "Cadastrar restaurante" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await getCurrentUser()) redirect("/");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">R$</div>
          <h1 className="text-2xl font-bold tracking-tight">Cadastrar restaurante</h1>
          <p className="mt-1 text-sm text-stone-600">Crie a conta do seu restaurante. Você será o administrador.</p>
        </div>
        <div className="card">
          {signupOpen() ? (
            <SignupForm />
          ) : (
            <p className="text-sm text-stone-700">O cadastro de novos restaurantes está fechado no momento. Fale com quem te indicou o sistema.</p>
          )}
        </div>
        <p className="mt-4 text-center text-sm text-stone-600">
          Já tem conta? <Link href="/login" className="link">Entrar</Link>
        </p>
      </div>
    </main>
  );
}
