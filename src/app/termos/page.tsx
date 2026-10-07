import type { Metadata } from "next";
import Link from "next/link";
import { COMPANY } from "@/lib/legal/company";
import { GRACE_DAYS, TRIAL_DAYS } from "@/lib/billing";
import { H, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Termos de Uso" };

export default function TermsPage() {
  return (
    <LegalPage title="Termos de Uso">
      <p>
        Estes termos regem o uso do sistema Fechamento de Caixa (o &quot;Sistema&quot;), oferecido por {COMPANY.name}, CNPJ {COMPANY.document},
        com sede em {COMPANY.address} (&quot;nós&quot;). Ao cadastrar um restaurante ou usar o Sistema, você declara que leu e aceita estes termos
        e a <Link href="/privacidade" className="link">Política de Privacidade</Link>. Se não concordar, não use o Sistema.
      </p>

      <H>1. O que é o Sistema</H>
      <p>
        O Sistema é uma ferramenta online para registrar vendas e movimentações do caixa, conferir valores, fechar o caixa por turno,
        gerar relatórios e enviar avisos por e-mail. Ele ajuda na organização e na conferência, mas não substitui contador,
        sistema de emissão de nota fiscal, equipamento fiscal exigido por lei nem a conferência humana dos valores.
      </p>

      <H>2. Cadastro e contas</H>
      <p>
        Quem cadastra o restaurante se torna o administrador da conta e declara ter poderes para contratar em nome dele.
        O administrador cadastra os demais usuários (gerentes e operadores) e responde pelo uso que eles fazem do Sistema.
        Cada usuário tem login próprio e não deve compartilhar a senha. Avise-nos em {COMPANY.email} se suspeitar de uso indevido.
      </p>

      <H>3. Teste grátis, assinatura e pagamento</H>
      <p>
        O restaurante novo tem {TRIAL_DAYS} dias de teste grátis, sem compromisso. Depois disso, o uso completo depende de assinatura mensal,
        no valor informado na tela Assinatura no momento da contratação. A cobrança é feita pela plataforma Asaas, e cada fatura pode ser paga
        por PIX, boleto ou cartão.
      </p>
      <p>
        Se uma mensalidade não for paga, o Sistema avisa e continua funcionando por {GRACE_DAYS} dias após o vencimento. Passado esse prazo,
        a conta fica em modo de consulta: não é possível abrir caixa novo, mas relatórios, histórico e o fechamento de caixa já aberto continuam
        disponíveis. O acesso completo volta assim que o pagamento é confirmado. Nenhum dado é apagado por atraso.
      </p>
      <p>
        O administrador pode cancelar a assinatura a qualquer momento, na tela Assinatura, sem multa. O cancelamento interrompe as cobranças
        seguintes; não há devolução proporcional do período já pago. Podemos reajustar o valor da mensalidade com aviso prévio de 30 dias
        por e-mail ao administrador.
      </p>

      <H>4. Responsabilidades do restaurante</H>
      <p>
        O restaurante é responsável pelos valores que lança, pela contagem do dinheiro, pela conferência com máquinas, extratos e plataformas
        e pelas decisões tomadas com base nos relatórios. Também é responsável pelos dados pessoais de funcionários que cadastra no Sistema,
        conforme a Política de Privacidade.
      </p>
      <p>É proibido usar o Sistema para fins ilegais, tentar acessar dados de outros restaurantes ou interferir no funcionamento do serviço.</p>

      <H>5. Disponibilidade</H>
      <p>
        Trabalhamos para manter o Sistema disponível e seguro, mas ele depende de internet e de serviços de terceiros (hospedagem, banco de dados,
        envio de e-mail e cobrança) e pode ficar fora do ar por manutenção ou falhas. Não garantimos funcionamento ininterrupto.
      </p>

      <H>6. Dados do restaurante</H>
      <p>
        Os dados lançados no Sistema pertencem ao restaurante. O administrador pode exportá-los a qualquer momento em CSV pelos relatórios.
        Mantemos os dados enquanto a conta existir. Depois do cancelamento, o administrador pode pedir a exclusão em {COMPANY.email};
        guardaremos apenas o que a lei obrigar, pelo prazo que ela exigir.
      </p>

      <H>7. Limitação de responsabilidade</H>
      <p>
        Na medida permitida pela lei, não respondemos por diferenças de caixa, perdas financeiras ou decisões de negócio decorrentes de
        lançamentos incorretos, falta de conferência ou indisponibilidade temporária do Sistema. Nossa responsabilidade total, em qualquer caso,
        fica limitada ao valor pago pelo restaurante nos 12 meses anteriores ao fato.
      </p>

      <H>8. Mudanças nestes termos</H>
      <p>
        Podemos atualizar estes termos. Mudanças relevantes serão avisadas por e-mail ao administrador ou no próprio Sistema, com antecedência.
        Continuar usando o Sistema depois da mudança significa aceitar a nova versão.
      </p>

      <H>9. Lei e foro</H>
      <p>
        Estes termos seguem a lei brasileira, incluindo o Código de Defesa do Consumidor quando aplicável. Fica eleito o foro de {COMPANY.forum}
        para resolver qualquer questão, ressalvado o direito do consumidor de usar o foro do seu domicílio.
      </p>

      <p>Dúvidas: {COMPANY.email}.</p>
    </LegalPage>
  );
}
