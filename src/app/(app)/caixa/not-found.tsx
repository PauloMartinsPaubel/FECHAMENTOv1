import Link from "next/link";

/** Caixa que não existe ou que esta pessoa não pode ver (ex.: operador abrindo caixa fechado de outra pessoa). */
export default function SessionNotFound() {
  return (
    <div className="card mx-auto max-w-lg space-y-3 text-center">
      <h1 className="text-lg font-bold">Este caixa não está disponível para você</h1>
      <p className="text-sm text-stone-600">
        O caixa não existe ou você não tem acesso a ele. Operadores veem os caixas abertos e os que eles mesmos abriram ou fecharam.
        Para ver fechamentos de outras pessoas, peça a um gerente.
      </p>
      <div className="flex justify-center gap-2">
        <Link href="/caixa" className="btn-primary">Ver meus caixas</Link>
        <Link href="/" className="btn-secondary">Ir para o início</Link>
      </div>
    </div>
  );
}
