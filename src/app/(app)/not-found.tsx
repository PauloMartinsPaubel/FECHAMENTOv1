import Link from "next/link";

export default function AppNotFound() {
  return (
    <div className="card mx-auto max-w-md space-y-3 text-center">
      <h1 className="text-lg font-bold">Página não encontrada</h1>
      <p className="text-sm text-stone-600">O endereço não existe ou você não tem acesso a ele.</p>
      <Link href="/" className="btn-primary">Ir para o início</Link>
    </div>
  );
}
