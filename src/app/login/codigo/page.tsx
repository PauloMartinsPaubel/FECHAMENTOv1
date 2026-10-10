import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { readToken } from "@/server/auth/current";
import { pendingLogin } from "@/server/services/two-factor";
import { SecondStepForm } from "./form";

export const metadata: Metadata = { title: "Código de verificação" };
export const dynamic = "force-dynamic";

export default async function SecondStepPage() {
  const pending = await pendingLogin(await readToken());
  if (!pending) redirect("/login");
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">R$</div>
          <h1 className="text-2xl font-bold tracking-tight">Verificação em duas etapas</h1>
          <p className="mt-1 text-sm text-stone-600">Olá, {pending.name}. Abra o aplicativo autenticador no celular e digite o código de 6 dígitos.</p>
        </div>
        <div className="card"><SecondStepForm /></div>
        <p className="mt-4 text-center text-sm text-stone-600">Sem o celular? Use um dos códigos de recuperação que você guardou. <Link href="/login" className="link">Voltar</Link></p>
      </div>
    </main>
  );
}
