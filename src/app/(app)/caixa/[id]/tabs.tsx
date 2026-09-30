"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
  { slug: "", label: "Lançamentos" },
  { slug: "/matriz", label: "Canal x forma" },
  { slug: "/conferencia", label: "Conferência" },
  { slug: "/fechamento", label: "Fechamento" },
  { slug: "/relatorio", label: "Relatório" },
];

export function SessionTabs({ id }: { id: string }) {
  const path = usePathname();
  const base = `/caixa/${id}`;
  return (
    <nav aria-label="Etapas do caixa" className="no-print mb-5 overflow-x-auto">
      <ul className="flex gap-1 whitespace-nowrap border-b border-stone-300">
        {TABS.map((t) => {
          const href = base + t.slug;
          const active = t.slug === "" ? path === base : path.startsWith(href);
          return (
            <li key={t.slug}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={`inline-block border-b-2 px-4 py-2.5 text-sm font-semibold ${active ? "border-brand-600 text-brand-700" : "border-transparent text-stone-600 hover:text-stone-900"}`}
              >
                {t.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
