import Link from "next/link";
import type { ClosingStep } from "@/lib/closing-steps";

const MARK: Record<ClosingStep["state"], string> = {
  done: "border-green-600 bg-green-600 text-white",
  current: "border-brand-600 bg-white text-brand-700",
  todo: "border-stone-300 bg-white text-stone-400",
};

/** Barra de passos do fechamento, com o que falta na etapa atual. */
export function ClosingStepsBar({ id, steps }: { id: string; steps: ClosingStep[] }) {
  const current = steps.find((s) => s.state === "current");
  return (
    <section aria-label="Passos do fechamento" className="no-print mb-4 rounded-xl border border-stone-200 bg-white p-3">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-2 text-sm">
        {steps.map((s, i) => (
          <li key={s.key} className="flex items-center gap-2">
            <Link href={`/caixa/${id}${s.slug}`} className="flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-stone-50" aria-current={s.state === "current" ? "step" : undefined}>
              <span className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs font-bold ${MARK[s.state]}`}>{s.state === "done" ? "✓" : i + 1}</span>
              <span className={s.state === "todo" ? "text-stone-500" : "font-semibold"}>{s.label}</span>
            </Link>
            {i < steps.length - 1 ? <span aria-hidden className="h-px w-6 bg-stone-300" /> : null}
          </li>
        ))}
      </ol>
      {current ? (
        <div className="mt-2 text-sm text-stone-700">
          <ul className="list-disc pl-5">{current.pending.map((p) => <li key={p}>{p}</li>)}</ul>
          {current.key !== "fechamento" ? (
            <Link href={`/caixa/${id}${current.slug}`} className="mt-1 inline-block font-semibold text-brand-700 hover:underline">Ir para {current.label.toLowerCase()}</Link>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-sm text-green-800">Caixa fechado. Relatório e envio por e-mail ficam na aba Fechamento.</p>
      )}
    </section>
  );
}
