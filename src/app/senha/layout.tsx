import Link from "next/link";

/** Moldura das telas de senha sem login (mesma cara da tela de entrada). */
export default function PasswordLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-600 text-2xl font-bold text-white">R$</div>
          <h1 className="text-2xl font-bold tracking-tight">Fechamento de Caixa</h1>
        </div>
        <div className="card">{children}</div>
        <p className="mt-4 text-center text-sm text-stone-600"><Link href="/login" className="link">Voltar para o login</Link></p>
      </div>
    </main>
  );
}
