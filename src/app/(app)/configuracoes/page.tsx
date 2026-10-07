import type { Metadata } from "next";
import { formatDecimalComma } from "@/lib/finance";
import { KIND_LABEL } from "@/lib/finance";
import { Alert, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth/current";
import { emailProvider } from "@/server/email/provider";
import { prisma } from "@/server/db";
import { getSettings, loadCatalogRows } from "@/server/loaders";
import { CatalogRow, NewCatalogItem, SettingsForm, WeeklyNowButton } from "./forms";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage() {
  const user = await requirePermission("settings.manage");
  const [settings, catalog, restaurant] = await Promise.all([
    getSettings(prisma, user.restaurantId),
    loadCatalogRows(prisma, user.restaurantId),
    prisma.restaurant.findUniqueOrThrow({ where: { id: user.restaurantId } }),
  ]);
  const provider = emailProvider();

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Fundo de caixa, tolerância, e-mail e cadastros." />

      <section className="card">
        <h2 className="card-title">Geral</h2>
        <SettingsForm
          values={{
            restaurantName: restaurant.name,
            defaultOpeningFloat: formatDecimalComma(settings.defaultOpeningFloatCents),
            tolerance: formatDecimalComma(settings.toleranceCents),
            defaultFloatMode: settings.defaultFloatMode,
            recipients: settings.closingRecipients.join(", "),
            emailFrom: settings.emailFrom ?? "",
            alertRecipients: settings.alertRecipients.join(", "),
            alertThreshold: settings.alertThresholdCents === null ? "" : formatDecimalComma(settings.alertThresholdCents),
            weeklyRecipients: settings.weeklyRecipients.join(", "),
          }}
        />
        {settings.weeklyRecipients.length ? <div className="mt-4"><WeeklyNowButton /></div> : null}
        <div className="mt-4">
          {provider === "none" ? (
            <Alert tone="warn">O envio de e-mail ainda não está configurado no servidor (variável EMAIL_PROVIDER). O fechamento funciona normalmente; o botão de enviar avisa o que falta e permite reenviar depois.</Alert>
          ) : (
            <Alert tone="ok">Envio de e-mail configurado no servidor: {provider === "smtp" ? "SMTP" : "Resend"}.</Alert>
          )}
        </div>
      </section>

      <Catalog title="Caixas" kind="register" help="Cada caixa tem a sua gaveta, o seu fundo e o seu fechamento por turno.">
        {catalog.registers.map((r) => <CatalogRow key={r.id} kind="register" item={{ id: r.id, name: r.name, active: r.active }} />)}
      </Catalog>

      <Catalog title="Turnos" kind="shift" help="Manhã e Tarde/Noite. Só nome e horário podem mudar.">
        {catalog.shifts.map((s) => <CatalogRow key={s.id} kind="shift" item={{ id: s.id, name: s.name, active: s.active, startTime: s.startTime, endTime: s.endTime }} />)}
      </Catalog>

      <Catalog title="Canais de venda" kind="channel" help="Canais são independentes: 99Food não está dentro da Eclética. Marque 'plataforma' para conferir o pagamento online separadamente.">
        {catalog.channels.map((c) => <CatalogRow key={c.id} kind="channel" item={{ id: c.id, name: c.name, active: c.active, isPlatform: c.isPlatform }} />)}
      </Catalog>

      <Catalog title="Formas de pagamento" kind="method" help="O tipo define como o valor é conferido e se mexe na gaveta. Só existe uma forma do tipo Dinheiro, e o tipo não muda depois de criada.">
        {catalog.methods.map((m) => <CatalogRow key={m.id} kind="method" item={{ id: m.id, name: m.name, active: m.active, methodKind: m.kind, methodKindLabel: KIND_LABEL[m.kind] }} />)}
      </Catalog>

      <Catalog title="Tickets e vales (bandeiras)" kind="brand" help="Cada bandeira é conferida separadamente (Alelo, VR, Ticket Restaurante, Pluxee, Ben e outras).">
        {catalog.brands.map((b) => <CatalogRow key={b.id} kind="brand" item={{ id: b.id, name: b.name, active: b.active }} />)}
      </Catalog>
    </div>
  );
}

function Catalog({ title, kind, help, children }: { title: string; kind: "register" | "shift" | "channel" | "method" | "brand"; help: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="card-title">{title}</h2>
      <p className="mb-3 text-sm text-stone-600">{help}</p>
      <ul className="divide-y divide-stone-100">{children}</ul>
      {kind !== "shift" ? (
        <div className="mt-4 border-t border-stone-200 pt-4">
          <NewCatalogItem kind={kind} />
        </div>
      ) : null}
    </section>
  );
}
