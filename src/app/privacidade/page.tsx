import type { Metadata } from "next";
import { COMPANY } from "@/lib/legal/company";
import { H, LegalPage } from "@/components/legal-page";

export const metadata: Metadata = { title: "Política de Privacidade" };

export default function PrivacyPage() {
  return (
    <LegalPage title="Política de Privacidade">
      <p>
        Esta política explica quais dados pessoais o sistema Fechamento de Caixa trata, para quê e quais são os seus direitos,
        conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018, LGPD). O serviço é prestado por {COMPANY.name}, CNPJ {COMPANY.document}.
      </p>

      <H>1. Quem decide e quem opera</H>
      <p>
        Sobre os dados de cadastro e cobrança da conta, somos o controlador. Sobre os dados que o restaurante lança no Sistema
        (por exemplo, nomes e e-mails dos seus funcionários e o registro de quem lançou ou fechou cada caixa), o restaurante é o controlador
        e nós atuamos como operador, tratando esses dados só para prestar o serviço e conforme as instruções do restaurante.
      </p>

      <H>2. Dados que tratamos</H>
      <ul className="list-disc space-y-1 pl-6">
        <li><strong>Cadastro:</strong> nome do restaurante, nome e e-mail do administrador e dos usuários, função e senha (guardada só em forma cifrada, que não permite recuperar a senha original).</li>
        <li><strong>Cobrança:</strong> CPF ou CNPJ e e-mail de quem paga, situação das mensalidades.</li>
        <li><strong>Uso do caixa:</strong> lançamentos, conferências, fechamentos, justificativas e observações, com o nome de quem fez cada ação.</li>
        <li><strong>Segurança:</strong> data, hora e endereço IP de acessos e de ações importantes, para auditoria e prevenção de fraude.</li>
        <li><strong>Pedidos de plataformas:</strong> quando o restaurante importa relatórios de pedidos (por exemplo, do iFood), guardamos número, horário, valores e forma de pagamento dos pedidos. Não pedimos nome, telefone ou endereço de clientes finais.</li>
      </ul>

      <H>3. Para que usamos</H>
      <ul className="list-disc space-y-1 pl-6">
        <li>Prestar o serviço contratado: login, registro e conferência do caixa, relatórios e e-mails de fechamento, alertas e resumos (base legal: execução de contrato).</li>
        <li>Cobrar a assinatura e emitir documentos fiscais (execução de contrato e cumprimento de obrigação legal).</li>
        <li>Manter a segurança e a trilha de auditoria (legítimo interesse e cumprimento de obrigação legal).</li>
        <li>Responder a pedidos e dar suporte.</li>
      </ul>
      <p>Não vendemos dados pessoais e não os usamos para publicidade.</p>

      <H>4. Com quem compartilhamos</H>
      <p>Só com fornecedores necessários para o serviço funcionar, que tratam os dados em nosso nome:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>Vercel (hospedagem do Sistema, com processamento em São Paulo);</li>
        <li>Supabase (banco de dados, hospedado em São Paulo);</li>
        <li>Asaas (cobrança das mensalidades);</li>
        <li>o provedor de e-mail configurado (envio de relatórios, alertas e resumos).</li>
      </ul>
      <p>Também podemos compartilhar dados quando a lei ou uma ordem judicial exigir.</p>

      <H>5. Cookies</H>
      <p>Usamos apenas um cookie essencial, que mantém você conectado depois do login. Não usamos cookies de propaganda nem de rastreamento.</p>

      <H>6. Segurança e guarda</H>
      <p>
        As conexões são criptografadas, as senhas são guardadas cifradas e cada restaurante só enxerga os próprios dados. Lançamentos e fechamentos
        não são apagados, apenas corrigidos com registro, porque isso protege o próprio restaurante. Mantemos os dados enquanto a conta existir;
        após o cancelamento, eles podem ser excluídos a pedido, exceto o que a lei obrigar a guardar.
      </p>

      <H>7. Seus direitos</H>
      <p>
        Você pode pedir confirmação de que tratamos seus dados, acesso, correção, anonimização ou exclusão de dados desnecessários, portabilidade,
        informação sobre compartilhamento e revisão de consentimento, nos termos do artigo 18 da LGPD. Se você é funcionário de um restaurante,
        o pedido sobre dados lançados pelo restaurante deve ser feito a ele; nós ajudaremos no que couber.
      </p>
      <p>Encarregado de dados (DPO): {COMPANY.dpoEmail}. Você também pode reclamar à Autoridade Nacional de Proteção de Dados (ANPD).</p>

      <H>8. Mudanças</H>
      <p>Esta política pode ser atualizada. A versão em vigor fica sempre nesta página, com a data no topo.</p>
    </LegalPage>
  );
}
