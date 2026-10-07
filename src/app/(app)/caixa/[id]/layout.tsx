import { formatDateBR, weekdayBR, fromDbDate } from "@/lib/dates";
import { formatBRL } from "@/lib/finance";
import { FLOAT_MODE_LABEL, SESSION_STATUS_LABEL } from "@/lib/reports/labels";
import { Badge } from "@/components/ui";
import { getSessionPage } from "@/server/session-page";
import { closingSteps } from "@/lib/closing-steps";
import { SessionTabs } from "./tabs";
import { ClosingStepsBar } from "./steps";

export default async function SessionLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { bundle } = await getSessionPage(id);
  const s = bundle.session;
  const date = fromDbDate(s.businessDate);
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight">{s.register.name} · {s.shift.name}</h1>
            <Badge kind={s.status}>{SESSION_STATUS_LABEL[s.status]}</Badge>
          </div>
          <p className="mt-1 text-sm text-stone-600">
            {formatDateBR(date)} ({weekdayBR(date)}) · Responsável: {s.responsible.name} · Fundo de abertura: <strong>{formatBRL(s.openingFloatCents)}</strong>{" "}
            <span className="text-stone-400">({FLOAT_MODE_LABEL[s.floatMode]})</span>
          </p>
        </div>
      </div>
      <ClosingStepsBar id={id} steps={closingSteps(bundle.evaluation, s.status)} />
      <SessionTabs id={id} />
      {children}
    </div>
  );
}
