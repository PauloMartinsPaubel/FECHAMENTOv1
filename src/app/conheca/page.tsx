import type { Metadata } from "next";
import Link from "next/link";
import { formatBRL } from "@/lib/finance";
import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/billing";
import { SUPPORT } from "@/lib/legal/company";
import { priceCentsFromEnv } from "@/server/services/billing";
import { signupOpen } from "@/server/services/signup";

export const metadata: Metadata = {
  title: "Fechamento de caixa para restaurantes",
  description: "Lance, confira e feche o caixa de cada turno sem planilha. Contagem de cédulas, conferência por forma de pagamento, alertas de diferença e relatórios.",
  robots: { index: true, follow: true },
};
export const dynamic = "force-dynamic";

const STEPS = [
  { n: "1", title: "Lançar", text: "Cada venda com canal e forma de pagamento. Os botões de lançamento rápido mostram as combinações que o restaurante mais usa: um toque, o valor, Enter." },
  { n: "2", title: "Conferir", text: "A recepção conta as notas e moedas e o sistema soma. Máquinas, PIX, tickets e plataformas ficam lado a lado com o que foi lançado." },
  { n: "3", title: "Fechar", text: "Diferença acima do limite pede justificativa. Depois de fechado, só o gerente reabre, com motivo, e tudo fica registrado." },
];

const FEATURES = [
  { title: "Fundo de caixa separado", text: "O troco da gaveta nunca entra como faturamento. O resultado do dia sai certo." },
  { title: "Nada é apagado", text: "Correções guardam o valor antigo, o novo, quem mudou e por quê. Isso protege o funcionário e o dono." },
  { title: "Alerta na hora", text: "Caixa fechou com diferença acima do limite? Chega um e-mail para o dono ou gerente." },
  { title: "Resumo toda segunda", text: "Faturamento por canal, ticket médio e diferenças por pessoa e turno, comparados com a semana anterior." },
  { title: "Tendências", text: "Gráficos por semana e por mês para ver se o faturamento cresce e se as diferenças diminuem." },
  { title: "Conferência do iFood", text: "Importe o relatório do Portal do Parceiro e veja se o que entrou no caixa bate com o aplicativo." },
  { title: "Tablet ou computador", text: "Funciona no navegador e vira aplicativo na tela inicial do tablet da recepção." },
  { title: "Mais de uma casa", text: "O mesmo login acessa todas as unidades, cada uma com caixa e relatórios próprios." },
];

const FAQ = [
  { q: "Preciso instalar alguma coisa?", a: "Não. Funciona no navegador do computador, do tablet ou do celular. No tablet dá para adicionar à tela inicial e usar como aplicativo." },
  { q: "Substitui meu sistema de pedidos ou o emissor de nota?", a: "Não. Ele cuida do caixa: lançamento, conferência e fechamento de cada turno. O sistema de pedidos e o emissor de nota continuam como estão." },
  { q: "Quanto tempo a recepção leva para aprender?", a: "Um turno. O fechamento é guiado: uma barra no topo mostra em que passo a pessoa está e o que falta. Acompanha um guia de treinamento em PDF." },
  { q: "E se eu quiser sair?", a: "Cancela na tela Assinatura, sem multa. O administrador baixa todos os dados do restaurante em planilhas quando quiser." },
  { q: "Meus dados ficam seguros?", a: "Cada restaurante só enxerga os próprios dados, as conexões são criptografadas, há cópia de segurança diária e a auditoria registra quem fez cada ação." },
];

export default function LandingPage() {
  const price = priceCentsFromEnv();
  const open = signupOpen();
  const whatsapp = SUPPORT.whatsapp ? `https://wa.me/${SUPPORT.whatsapp}?text=${encodeURIComponent(`Olá! Quero testar o Fechamento de Caixa por ${TRIAL_DAYS} dias.`)}` : null;
  // o cadastro pede código de convite: quem chega pela página pede o teste no WhatsApp; quem já tem o código cadastra direto
  const cta = whatsapp ? { href: whatsapp, label: `Quero testar ${TRIAL_DAYS} dias grátis` } : open ? { href: "/cadastro", label: `Testar ${TRIAL_DAYS} dias grátis` } : null;
  const inviteLink = open && whatsapp ? <Link href="/cadastro" className="link">Já tenho um código de convite</Link> : null;

  return (
    <div className="bg-[#F6F4EE] text-stone-900">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5">
        <span className="flex items-center gap-2 font-bold">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600 text-sm text-white">R$</span>
          <span>Fechamento de Caixa</span>
        </span>
        <Link href="/login" className="btn-secondary btn-sm">Entrar</Link>
      </header>

      <section className="mx-auto grid max-w-6xl items-center gap-10 px-4 pb-16 pt-6 lg:grid-cols-[1fr_1.1fr]">
        <div>
          <p className="text-sm font-bold uppercase tracking-wider text-brand-700">Para restaurantes</p>
          <h1 className="mt-3 text-4xl font-extrabold leading-tight tracking-tight text-[#123B26] sm:text-5xl">
            O caixa de cada turno conferido e fechado em minutos.
          </h1>
          <p className="mt-5 text-lg leading-relaxed text-stone-700">
            Sem planilha, sem conta de cabeça e sem diferença sem explicação. A recepção lança, confere e fecha; o dono acompanha de onde estiver.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            {cta ? <a href={cta.href} className="btn-primary px-6">{cta.label}</a> : null}
            <a href="#como-funciona" className="btn-secondary px-6">Ver como funciona</a>
          </div>
          <p className="mt-3 text-sm text-stone-500">Feito dentro de um restaurante de verdade, que usa o sistema todo dia.</p>
          {inviteLink ? <p className="mt-2 text-sm">{inviteLink}</p> : null}
        </div>
        <img src="/apresentacao/lancamentos.png" alt="Tela de lançamentos com os botões de lançamento rápido" width={1200} height={800} className="w-full rounded-2xl border border-stone-200 bg-white shadow-xl" />
      </section>

      <section className="bg-white py-16">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold tracking-tight text-[#123B26]">O problema que ele resolve</h2>
          <div className="mt-8 grid gap-5 md:grid-cols-3">
            {[
              ["Conta na mão", "Caderno, calculadora e planilha. Um número trocado e o caixa não fecha, e ninguém sabe onde errou."],
              ["Fundo misturado", "O troco da gaveta entra no faturamento e o resultado do dia fica maior do que foi."],
              ["Sem rastro", "Quando falta dinheiro, não dá para saber quem lançou, quando e o que foi alterado."],
            ].map(([t, d]) => (
              <div key={t} className="rounded-2xl border border-stone-200 bg-[#F6F4EE] p-6">
                <h3 className="text-lg font-bold">{t}</h3>
                <p className="mt-2 text-stone-700">{d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="como-funciona" className="mx-auto max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold tracking-tight text-[#123B26]">Como funciona</h2>
        <p className="mt-2 text-stone-700">Três passos em todo turno, com uma barra no topo mostrando o que falta.</p>
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n} className="rounded-2xl border border-stone-200 bg-white p-6">
              <p className="text-5xl font-extrabold text-brand-600">{s.n}</p>
              <h3 className="mt-3 text-xl font-bold">{s.title}</h3>
              <p className="mt-2 text-stone-700">{s.text}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <figure>
            <img src="/apresentacao/conferencia.png" alt="Conferência do caixa com o cálculo do dinheiro esperado" width={1200} height={800} className="w-full rounded-2xl border border-stone-200 bg-white shadow" />
            <figcaption className="mt-2 text-sm text-stone-500">Conferência: o sistema mostra quanto deveria ter em cada forma de pagamento.</figcaption>
          </figure>
          <figure>
            <img src="/apresentacao/fechamento.png" alt="Caixa fechado com o resultado e a justificativa" width={1200} height={800} className="w-full rounded-2xl border border-stone-200 bg-white shadow" />
            <figcaption className="mt-2 text-sm text-stone-500">Fechamento: resultado, justificativa e relatório pronto para enviar.</figcaption>
          </figure>
        </div>
      </section>

      <section className="bg-[#123B26] py-16 text-[#F6F4EE]">
        <div className="mx-auto max-w-6xl px-4">
          <h2 className="text-3xl font-bold tracking-tight">Tudo o que vem junto</h2>
          <div className="mt-8 grid gap-x-8 gap-y-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div key={f.title}>
                <h3 className="font-bold text-[#E9C46A]">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-[#CFE3D6]">{f.text}</p>
              </div>
            ))}
          </div>
          <img src="/apresentacao/tendencias.png" alt="Painel de tendências com gráficos de faturamento por semana" width={1200} height={800} className="mt-10 w-full rounded-2xl bg-white shadow-xl" />
        </div>
      </section>

      <section id="plano" className="mx-auto max-w-6xl px-4 py-16">
        <div className="rounded-3xl bg-brand-600 p-8 text-white sm:p-12">
          <h2 className="text-3xl font-bold tracking-tight">Plano</h2>
          <div className="mt-6 flex flex-wrap items-end gap-x-16 gap-y-6">
            <div>
              <p className="text-5xl font-extrabold">{TRIAL_DAYS} dias</p>
              <p className="mt-1 text-green-100">grátis, sem compromisso e sem cartão</p>
            </div>
            <div>
              <p className="text-5xl font-extrabold">{price ? formatBRL(price) : "Consulte"}</p>
              <p className="mt-1 text-green-100">{price ? "por mês, por unidade" : "o valor por unidade"}</p>
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-green-50">
            PIX, boleto ou cartão. Cancele quando quiser, sem multa. Se uma mensalidade atrasar, o sistema continua funcionando por {GRACE_DAYS} dias, e nenhum dado é apagado.
          </p>
          {cta ? <a href={cta.href} className="mt-8 inline-flex min-h-11 items-center rounded-lg bg-white px-6 font-semibold text-brand-700 hover:bg-green-50">{cta.label}</a> : null}
          {inviteLink ? <p className="mt-3 text-sm text-green-50"><Link href="/cadastro" className="underline">Já tenho um código de convite</Link></p> : null}
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-16">
        <h2 className="text-3xl font-bold tracking-tight text-[#123B26]">Perguntas frequentes</h2>
        <div className="mt-6 divide-y divide-stone-300">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-4">
              <summary className="cursor-pointer list-none text-lg font-semibold">{f.q}</summary>
              <p className="mt-2 text-stone-700">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="border-t border-stone-300 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 text-sm text-stone-600">
          <span>Fechamento de Caixa</span>
          <span className="flex flex-wrap gap-4">
            {whatsapp ? <a href={whatsapp} className="hover:underline" target="_blank" rel="noreferrer">WhatsApp</a> : null}
            {SUPPORT.email ? <a href={`mailto:${SUPPORT.email}`} className="hover:underline">{SUPPORT.email}</a> : null}
            <Link href="/termos" className="hover:underline">Termos de Uso</Link>
            <Link href="/privacidade" className="hover:underline">Privacidade</Link>
            <Link href="/login" className="hover:underline">Entrar</Link>
          </span>
        </div>
      </footer>
    </div>
  );
}
