import Link from "next/link";
import { formatBRL, formatSigned } from "@/lib/finance";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-stone-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-stone-600">{subtitle}</p> : null}
      </div>
      {actions ? <div className="no-print flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Money({ cents, className = "" }: { cents: number; className?: string }) {
  return <span className={`tabular-nums ${className}`}>{formatBRL(cents)}</span>;
}

/** Diferença com cor e sinal: falta vermelho, sobra âmbar, zero verde. */
export function Diff({ cents, pending = false }: { cents: number | null; pending?: boolean }) {
  if (cents === null || pending) return <span className="text-stone-400">pendente</span>;
  const cls = cents < 0 ? "text-red-700" : cents > 0 ? "text-amber-700" : "text-green-700";
  return <span className={`font-semibold tabular-nums ${cls}`}>{formatSigned(cents)}</span>;
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: "default" | "good" | "bad" | "warn";
}) {
  const tones = {
    default: "border-stone-200 bg-white",
    good: "border-green-300 bg-green-50",
    bad: "border-red-300 bg-red-50",
    warn: "border-amber-300 bg-amber-50",
  };
  return (
    <div className={`rounded-xl border p-4 ${tones[tone]}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums sm:text-2xl">{value}</div>
      {hint ? <div className="mt-1 text-xs text-stone-500">{hint}</div> : null}
    </div>
  );
}

const BADGE: Record<string, string> = {
  CORRETO: "bg-green-100 text-green-800",
  FALTA: "bg-red-100 text-red-800",
  SOBRA: "bg-amber-100 text-amber-800",
  MISTO: "bg-orange-100 text-orange-800",
  OPEN: "bg-blue-100 text-blue-800",
  CLOSED: "bg-stone-200 text-stone-800",
  REOPENED: "bg-amber-100 text-amber-800",
  CORRECTED: "bg-violet-100 text-violet-800",
  ACTIVE: "bg-stone-100 text-stone-700",
  VOIDED: "bg-stone-200 text-stone-500 line-through",
  CANCELLED: "bg-red-100 text-red-800",
  SENT: "bg-green-100 text-green-800",
  FAILED: "bg-red-100 text-red-800",
  PENDING: "bg-stone-100 text-stone-600",
  none: "bg-stone-100 text-stone-600",
};

export function Badge({ kind, children }: { kind: string; children: React.ReactNode }) {
  return <span className={`badge ${BADGE[kind] ?? BADGE.none}`}>{children}</span>;
}

export function Alert({ tone = "error", children }: { tone?: "error" | "warn" | "ok" | "info"; children: React.ReactNode }) {
  const tones = {
    error: "border-red-300 bg-red-50 text-red-900",
    warn: "border-amber-300 bg-amber-50 text-amber-900",
    ok: "border-green-300 bg-green-50 text-green-900",
    info: "border-blue-300 bg-blue-50 text-blue-900",
  };
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-lg border px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-stone-300 px-4 py-6 text-center text-sm text-stone-500">{children}</p>;
}

export function Pagination({ page, pages, basePath, params }: { page: number; pages: number; basePath: string; params: Record<string, string | undefined> }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
    q.set("page", String(p));
    return `${basePath}?${q.toString()}`;
  };
  return (
    <div className="no-print mt-4 flex items-center justify-between text-sm">
      {page > 1 ? <Link className="btn-secondary btn-sm" href={href(page - 1)}>Anterior</Link> : <span />}
      <span className="text-stone-600">Página {page} de {pages}</span>
      {page < pages ? <Link className="btn-secondary btn-sm" href={href(page + 1)}>Próxima</Link> : <span />}
    </div>
  );
}

export function Field({ label, htmlFor, hint, children, className = "" }: { label: string; htmlFor?: string; hint?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="label" htmlFor={htmlFor}>{label}</label>
      {children}
      {hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}
    </div>
  );
}
