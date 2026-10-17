"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";

export type NavItem = { href: string; label: string };
export type NavGroup = { label: string; items: NavItem[] };

const isActive = (pathname: string, href: string) => (href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/"));

const LINK = "inline-flex min-h-10 items-center rounded-md px-3 text-sm font-medium transition-colors";
const IDLE = "text-stone-700 hover:bg-stone-100";
const ON = "bg-green-50 font-semibold text-green-800";

/** Grupo que abre uma lista. Fecha ao escolher, ao clicar fora, com Esc e ao mudar de página. */
function Dropdown({ label, sections, pathname, alignRight, className = "" }: { label: string; sections: { label?: string; items: NavItem[] }[]; pathname: string; alignRight?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLLIElement>(null);
  const id = useId();
  const active = sections.some((s) => s.items.some((i) => isActive(pathname, i.href)));

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <li ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`${LINK} gap-1 ${active ? ON : IDLE}`}
      >
        {label}
        <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 opacity-70" fill="currentColor">
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
        </svg>
      </button>
      {open ? (
        <div
          id={id}
          className={`absolute top-full z-30 mt-1 max-h-[75vh] min-w-56 overflow-y-auto rounded-lg border border-stone-200 bg-white p-1 shadow-lg ${alignRight ? "right-0" : "left-0"}`}
        >
          {sections.map((sec) => (
            <div key={sec.label ?? "itens"} className="py-1">
              {sec.label ? <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{sec.label}</p> : null}
              <ul>
                {sec.items.map((i) => {
                  const on = isActive(pathname, i.href);
                  return (
                    <li key={i.href}>
                      <Link href={i.href} onClick={() => setOpen(false)} aria-current={on ? "page" : undefined} className={`flex min-h-11 w-full items-center rounded-md px-3 text-sm ${on ? ON : IDLE}`}>
                        {i.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Menu principal: os itens do dia a dia ficam à vista e o resto vai em grupos. No celular, os grupos
 * viram um único "Mais", para nada ficar escondido numa faixa que rola de lado.
 */
export function MainNav({ primary, groups }: { primary: NavItem[]; groups: NavGroup[] }) {
  const pathname = usePathname();
  const visible = groups.filter((g) => g.items.length > 0);
  return (
    <nav aria-label="Principal" className="mx-auto max-w-6xl px-4 pb-2">
      <ul className="flex flex-wrap items-center gap-1">
        {primary.map((i) => {
          const on = isActive(pathname, i.href);
          return (
            <li key={i.href}>
              <Link href={i.href} aria-current={on ? "page" : undefined} className={`${LINK} ${on ? ON : IDLE}`}>
                {i.label}
              </Link>
            </li>
          );
        })}
        {/* computador: um grupo por menu */}
        {visible.map((g, n) => (
          <Dropdown key={g.label} className="hidden md:block" label={g.label} sections={[{ items: g.items }]} pathname={pathname} alignRight={n === visible.length - 1 && visible.length > 1} />
        ))}
        {/* celular: tudo num "Mais", separado pelos mesmos grupos */}
        {visible.length > 0 ? <Dropdown className="md:hidden" label="Mais" sections={visible} pathname={pathname} alignRight /> : null}
      </ul>
    </nav>
  );
}
