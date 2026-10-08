import type { Metadata } from "next";
import { formatDecimalComma } from "@/lib/finance";
import { KIND_LABEL } from "@/lib/finance";
import { Alert, PageHeader } from "@/components/ui";
import { requirePermission } from "@/server/auth/current";
import { emailProvider } from "@/server/email/provider";
import { prisma } from "@/server/db";
import { getSettings, loadCatalogRows } from "@/server/loaders";
import { CreateUnitForm } from "../usuarios/access-forms";
import { DemoButton } from "@/components/demo-button";
import { SiteStatsCard } from "@/components/site-stats-card";
import { siteStats } from "@/server/services/site-stats";
import { DEMO_UNIT_NAME, demoStatus } from "@/server/services/demo";
import { CatalogRow, NewCatalogItem, SettingsForm, WeeklyNowButton } from "./forms";

export const metadata: Metadata = { title: "Configurações" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const welcome = (await searchParams).inicio === "1";
  const user = await requirePermission("settings.manage");
  const [settings, catalog, restaurant] = await Promise.all([
    getSettings(prisma, user.restaurantId),
    loadCatalogRows(prisma, user.restaurantId),
    prisma.restaurant.findUniqueOrThrow({ where: { id: user.restaurantId } }),
  ]);
  const provider = emailProvider();
  // a demonstração é ferramenta de venda do dono do sistema (conta isenta), não de clientes
  const demo = restaurant.billingPlan === "EXEMPT" && restaurant.name !== DEMO_UNIT_NAME ? await demoStatus(user.userId) : "ready";
  const canDemo = demo !== "ready";
  // números da página de apresentação: só para a conta do dono do sistema
  const isOwner = restaurant.billingPlan === "EXEMPT" && restaurant.name !== DEMO_UNIT_NAME;
  const [week, month] = isOwner ? await Promise.all([siteStats(7), siteStats(30)]) : [null, null];

  return (
    <div className="space-y-6">
      <PageHeader title="Configurações" subtitle="Fundo de caixa, tolerância, e-mail e cadastros." />

      {welcome ? (
        <section className="card border-2 border-brand-600 bg-brand-50">
          <h2 className="text-lg font-bold">Bem-vindo! Restaurante criado.</h2>
          <p className="mt-1 text-sm text-stone-700">Já deixamos tudo com os valores mais comuns. Confira estes pontos antes do primeiro caixa:</p>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm">
            <li><strong>Fundo e tolerância</strong>: abaixo, em Geral. O fundo padrão é R$ 100,00 e a tolerância começa em zero.</li>
            <li><strong>Turnos</strong>: Manhã (06:00 às 15:00) e Tarde/Noite (15:00 às 23:59). Ajuste os horários mais abaixo.</li>
            <li><strong>Caixas, canais e formas de pagamento</strong>: renomeie, desative o que não usa e acrescente o que falta.</li>
            <li><strong>Equipe</strong>: cadastre gerentes e operadores em <a className="link" href="/usuarios">Usuários</a>.</li>
            <li><strong>E-mails</strong>: quem recebe o relatório de cada fechamento, os alertas de diferença e o resumo semanal.</li>
          </ol>
        </section>
      ) : null}

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

      <section className="card">
        <h2 className="card-title">Seus dados</h2>
        <p className="mb-3 text-sm text-stone-600">Baixe tudo o que o restaurante lançou no sistema, numa pasta compactada com uma planilha por assunto: caixas, vendas, conferências, fechamentos, correções, usuários e auditoria. Senhas não vão junto.</p>
        <a href="/api/exportacao-completa" className="btn-secondary">Baixar todos os dados (.zip)</a>
      </section>

      <section className="card">
        <h2 className="card-title">Outra unidade</h2>
        <p className="mb-3 text-sm text-stone-600">Para quem tem mais de um restaurante. A nova unidade tem caixa, cadastros, relatórios e assinatura próprios; você entra nela com o mesmo login e troca no seletor do topo.</p>
        <CreateUnitForm />
      </section>

      {week && month ? (
        <section className="card">
          <h2 className="card-title">Página de apresentação</h2>
          <p className="mb-3 text-sm text-stone-600">Quantas pessoas abriram a página e quantas clicaram para falar com você. Robôs e a prévia do link no WhatsApp não contam. Nenhum dado pessoal é guardado.</p>
          <SiteStatsCard week={week} month={month} />
        </section>
      ) : null}

      {canDemo ? (
        <section className="card">
          <h2 className="card-title">Demonstração para clientes</h2>
          <p className="mb-3 text-sm text-stone-600">
            Cria a unidade &quot;{DEMO_UNIT_NAME}&quot; com seis semanas de caixas fictícios (vendas, sangrias, conferências, algumas diferenças justificadas)
            e um caixa de hoje aberto. Serve para apresentar o sistema e tirar telas sem mostrar os números do seu restaurante. Os dados do seu restaurante não mudam.
          </p>
          {demo === "incomplete" ? <p className="mb-3 text-sm text-amber-800">A geração anterior foi interrompida antes do fim. O botão continua de onde parou.</p> : null}
          <DemoButton resume={demo === "incomplete"} />
        </section>
      ) : null}
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
