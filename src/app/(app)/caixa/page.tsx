import type { Metadata } from "next";
import Link from "next/link";
import { addDays, fromDbDate, todayIso, toDbDate, formatDateBR } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { can } from "@/lib/permissions";
import { SESSION_STATUS_LABEL } from "@/lib/reports/labels";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { requireUser } from "@/server/auth/current";
import { prisma } from "@/server/db";
import { getSettings, loadCatalogRows } from "@/server/loaders";
import { canAccessSession } from "@/server/services/sessions";
import { OpenSessionForm } from "./open-form";

export const metadata: Metadata = { title: "Caixa" };

export default async function CashPage() {
  const user = await requireUser();
  const today = todayIso();
  const [catalog, settings, recent] = await Promise.all([
    loadCatalogRows(prisma, user.restaurantId),
    getSettings(prisma, user.restaurantId),
    prisma.cashSession.findMany({
      where: {
        restaurantId: user.restaurantId,
        OR: [{ status: { in: ["OPEN", "REOPENED"] } }, { businessDate: { gte: toDbDate(addDays(today, -2)) } }],
      },
      include: { register: true, shift: true, responsible: { select: { name: true } } },
      orderBy: [{ businessDate: "desc" }, { shift: { sortOrder: "desc" } }],
    }),
  ]);
  const visible = recent.filter((s) => canAccessSession(user, s));
  const working = visible.filter((s) => s.status === "OPEN" || s.status === "REOPENED");
  const candidates = visible
    .filter((s) => s.status === "CLOSED" || s.status === "CORRECTED")
    .map((s) => ({
      id: s.id,
      registerId: s.registerId,
      date: fromDbDate(s.businessDate),
      shiftName: s.shift.name,
      shiftOrder: s.shift.sortOrder,
      floatCents: s.openingFloatCents,
      usedAsSource: recent.some((x) => x.transferredFromId === s.id),
    }));

  return (
    <div>
      <PageHeader title="Caixa" subtitle="Continue um caixa aberto ou abra o caixa de um turno." />

      {working.length > 0 ? (
        <section className="mb-6">
          <h2 className="card-title">Caixas em andamento</h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {working.map((s) => (
              <li key={s.id}>
                <Link href={`/caixa/${s.id}`} className="card block transition hover:border-brand-600">
                  <div className="flex items-center justify-between gap-2">
                    <strong className="text-lg">{s.register.name} · {s.shift.name}</strong>
                    <Badge kind={s.status}>{SESSION_STATUS_LABEL[s.status]}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-stone-600">
                    {formatDateBR(fromDbDate(s.businessDate))} · {s.responsible.name} · fundo {formatBRL(s.openingFloatCents)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="mb-6"><Empty>Nenhum caixa aberto no momento.</Empty></div>
      )}

      {can(user.role, "session.open") ? (
        <section className="card">
          <h2 className="card-title">Abrir caixa</h2>
          <OpenSessionForm
            registers={catalog.registers.filter((r) => r.active).map((r) => ({ id: r.id, name: r.name }))}
            shifts={catalog.shifts.filter((s) => s.active).map((s) => ({ id: s.id, name: s.name, order: s.sortOrder }))}
            today={today}
            minDate={can(user.role, "closing.correct") ? undefined : addDays(today, -1)}
            defaultFloat={formatBRL(settings.defaultOpeningFloatCents).replace("R$ ", "")}
            defaultMode={settings.defaultFloatMode}
            candidates={candidates}
          />
        </section>
      ) : null}
    </div>
  );
}
