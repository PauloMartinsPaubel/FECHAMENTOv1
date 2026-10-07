import { SUPPORT } from "@/lib/legal/company";

/** Contato do suporte, se configurado. */
export function SupportLinks({ className = "" }: { className?: string }) {
  if (!SUPPORT.email && !SUPPORT.whatsapp) return null;
  return (
    <span className={className}>
      Suporte:{" "}
      {SUPPORT.whatsapp ? <a className="hover:underline" href={`https://wa.me/${SUPPORT.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp</a> : null}
      {SUPPORT.whatsapp && SUPPORT.email ? " · " : null}
      {SUPPORT.email ? <a className="hover:underline" href={`mailto:${SUPPORT.email}`}>{SUPPORT.email}</a> : null}
    </span>
  );
}
