import Link from "next/link";
import { companyIncomplete, TERMS_VERSION } from "@/lib/legal/company";

/** Moldura das páginas públicas de Termos e Privacidade. */
export function LegalPage({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/login" className="mb-6 inline-flex items-center gap-2 font-bold">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">R$</span>
        <span>Fechamento de Caixa</span>
      </Link>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-stone-500">Versão de {TERMS_VERSION.split("-").reverse().join("/")}</p>
      {companyIncomplete ? (
        <p className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Rascunho: os dados da empresa ainda não foram preenchidos e o texto ainda não passou por revisão jurídica.
        </p>
      ) : null}
      <article className="legal mt-6 space-y-4 text-[15px] leading-relaxed text-stone-800">{children}</article>
      <p className="mt-10 text-sm text-stone-500">
        <Link href="/termos" className="link">Termos de Uso</Link> · <Link href="/privacidade" className="link">Política de Privacidade</Link>
      </p>
    </main>
  );
}

export function H({ children }: { children: React.ReactNode }) {
  return <h2 className="pt-4 text-lg font-bold">{children}</h2>;
}
