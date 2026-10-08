import type { Metadata } from "next";
import Link from "next/link";
import { resetTokenIsValid } from "@/server/services/password-reset";
import { NewPasswordForm } from "./form";

export const metadata: Metadata = { title: "Criar senha nova", referrer: "no-referrer" };
export const dynamic = "force-dynamic";

export default async function NewPasswordPage({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t } = await searchParams;
  const token = typeof t === "string" ? t : "";
  if (!(await resetTokenIsValid(token))) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-lg font-bold">Este link não vale mais</h2>
        <p className="text-sm text-stone-600">O link expira em 30 minutos e só pode ser usado uma vez. Peça um novo.</p>
        <Link href="/senha/esqueci" className="btn-primary w-full">Pedir novo link</Link>
      </div>
    );
  }
  return (
    <>
      <h2 className="mb-4 text-lg font-bold">Criar senha nova</h2>
      <NewPasswordForm token={token} />
    </>
  );
}
