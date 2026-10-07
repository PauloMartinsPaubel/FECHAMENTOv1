# Arquitetura do Sistema de Caixa, Conferência e Fechamento

Este documento foi escrito antes do código. Ele fixa as regras financeiras, o modelo de dados, o fluxo, as telas, as permissões e a auditoria. Onde o código e este texto divergirem, o texto é a referência e o código está errado.

## 1. Arquitetura

| Camada | Escolha | Motivo |
|---|---|---|
| Interface e servidor | Next.js 15 (App Router) com TypeScript | Um único projeto, renderização no servidor, Server Actions para gravar |
| Banco | PostgreSQL 16 | Transações, travas de linha, restrições CHECK |
| Acesso a dados | Prisma 7 com adaptador `pg` | Schema tipado e migrações versionadas |
| Validação | Zod | Toda entrada é validada no servidor, nunca só no navegador |
| Estilo | Tailwind CSS 4 | Interface responsiva (tablet no balcão, computador na gerência) |
| Senhas | bcryptjs (custo 12) | Sem dependência nativa |
| E-mail | Nodemailer (SMTP) ou Resend (API HTTP) | Escolhido por variável de ambiente |
| Testes | Vitest | Unitários do motor financeiro e integração contra PostgreSQL real |

Camadas do código, da mais pura para a mais externa:

1. `src/lib/finance`: motor financeiro puro (sem banco, sem Next). Recebe movimentações já carregadas e devolve totais, conferência, divergência e análise de origem. É a única fonte de fórmulas do sistema. Tudo que aparece em tela, relatório, CSV e e-mail passa por ele.
2. `src/server/services`: regras de negócio com banco (abrir caixa, lançar, cancelar, conferir, fechar, reabrir, corrigir, enviar e-mail). Cada função recebe o usuário que age e grava a auditoria na mesma transação.
3. `src/app`: páginas (Server Components) e Server Actions. Só chamam serviços.
4. `src/lib/reports`: geradores de relatório em HTML, usados na tela, na impressão e no anexo do e-mail, e geradores de CSV.

Nenhuma página calcula dinheiro por conta própria.

## 2. Dinheiro

Todo valor monetário é inteiro em centavos (`Int` no banco, `number` inteiro no código). Nunca há `float` de dinheiro. A entrada digitada ("1.234,56") é convertida por `parseMoney` com validação estrita. A saída usa `formatBRL`. O banco tem CHECK de que valores de movimentação são positivos; o sinal vem do tipo e dos efeitos.

## 3. Regras financeiras

### 3.1 Dois saldos que nunca se misturam

Cada movimentação carrega dois efeitos, gravados na própria linha e auditáveis:

- `revenueEffect` (-1, 0 ou +1): afeta o FATURAMENTO?
- `cashEffect` (-1, 0 ou +1): afeta o SALDO FÍSICO DO CAIXA (gaveta de dinheiro)?

| Tipo | Faturamento | Saldo físico | Observação |
|---|---|---|---|
| VENDA | +1 | +1 se a forma é dinheiro, senão 0 | exige canal e forma de pagamento |
| FUNDO DE ABERTURA | 0 | +1 | vem da sessão do caixa, não é venda |
| SUPRIMENTO | 0 | +1 | entrada de dinheiro na gaveta |
| SANGRIA | 0 | -1 | retirada de dinheiro da gaveta |
| DESPESA | 0 | -1 se paga em dinheiro, senão 0 | exige descrição |
| ESTORNO | -1 | -1 se devolvido em dinheiro, senão 0 | exige canal e forma |
| CANCELAMENTO | 0 | 0 | registro separado; se cancelou uma venda lançada, a venda sai dos cálculos |
| AJUSTE | informado | informado | exige motivo; só afeta o saldo físico se a forma for dinheiro |

O efeito de cada tipo é decidido por uma única função, `classifyMovement`, usada na criação e conferida pelo motor em toda leitura. Se uma linha gravada divergir da regra, o motor acusa erro de integridade em vez de calcular em silêncio.

### 3.2 Fórmulas

```
FATURAMENTO            = soma(valor x revenueEffect)        = vendas - estornos +/- ajustes de faturamento
DINHEIRO ESPERADO      = FUNDO + soma(valor x cashEffect)   = fundo + vendas em dinheiro + suprimentos
                                                              - sangrias - despesas em dinheiro
                                                              - estornos em dinheiro +/- ajustes
VALORES CONTROLADOS    = FATURAMENTO + FUNDO                 (rótulo próprio, nunca chamado de faturamento)
DIFERENÇA DE DINHEIRO  = DINHEIRO CONTADO - DINHEIRO ESPERADO
DIFERENÇA DE CARTÃO    = CONFERIDO - (crédito + débito no sistema)
```

O fundo entra somente em DINHEIRO ESPERADO e em VALORES CONTROLADOS. Cartão, PIX, tickets, online e outros nunca recebem o fundo. O fundo nunca é somado em faturamento.

Cancelamentos não entram em faturamento líquido: a venda cancelada tem status `CANCELLED` e sai de todas as somas. O registro continua no banco.

### 3.3 Conferência

A conferência tem uma linha por item conferível:

- Dinheiro: esperado inclui o fundo.
- Crédito e débito: uma linha cada, mais o total de cartões.
- PIX e outros: uma linha por forma de pagamento.
- Tickets: uma linha por bandeira (Alelo, VR, Ticket, Pluxee, Ben, Outros), mais o total.
- Online: uma linha por plataforma/canal (iFood, 99Food, Site próprio etc.), mais o total.

As linhas de bandeira e de plataforma são a decomposição do grupo, nunca uma soma extra. Invariante testada: a soma do "sistema" de todas as linhas é igual ao faturamento.

Cada linha tem `sistema`, `esperado` (igual ao sistema, exceto dinheiro), `conferido` (digitado) e `diferença = conferido - esperado`. Negativo é falta, positivo é sobra.

Fechar exige conferido em toda linha que tenha valor no sistema. Linha com sistema zero e sem digitação conta como zero.

### 3.4 Divergência, tolerância e status

- Divergência líquida: soma das diferenças com sinal.
- Divergência absoluta: soma dos módulos. A tolerância é comparada com ela, para que uma falta de R$ 50 em cartão não seja escondida por uma sobra de R$ 50 em dinheiro.
- Acima da tolerância (configurável, padrão R$ 0,00): justificativa obrigatória.
- Status: `CORRETO` (tudo zero), `FALTA` (só diferenças negativas), `SOBRA` (só positivas), `MISTO` (falta e sobra ao mesmo tempo).
- Análise de origem: a divergência é quebrada por dinheiro, crédito, débito, PIX, tickets (por bandeira), online (por plataforma) e outros, e o motor aponta pistas objetivas (diferença igual ao fundo, igual a uma sangria, despesa, estorno ou venda cancelada do turno, ou múltiplo exato de um lançamento).

### 3.5 Canais

Canais são linhas independentes. Não existe hierarquia nem grupo: 99Food não pertence à Eclética, e nada soma um canal dentro de outro. A matriz canal x forma de pagamento mostra só os valores gravados em cada canal. Invariante testada: soma da matriz = faturamento.

### 3.6 Turnos e fundo

Turnos: MANHÃ e TARDE/NOITE. Cada sessão de caixa é única por (caixa, turno, data) e tem fundo, responsável, movimentações, conferência e fechamento próprios.

Modo do fundo (configurável e escolhido na abertura):

- `NEW_OPENING` (nova abertura): o turno começa com fundo novo. No consolidado do dia, os fundos dos dois turnos aparecem separados e somam.
- `TRANSFER` (transferência entre turnos): o fundo vem do turno anterior. No consolidado aparece como "transferido" e não é somado de novo.

Consolidado do dia nunca soma fundo transferido como entrada nova.

### 3.7 Riscos de dupla contabilização e como cada um é barrado

| Risco | Barreira |
|---|---|
| Fundo virando faturamento | Campos separados no motor e nos relatórios; teste dos cinco cenários obrigatórios |
| Fundo contado duas vezes no dia | Modo `TRANSFER` no consolidado |
| 99Food dentro da Eclética | Canais independentes; matriz e invariante de soma |
| Venda cancelada continuando no faturamento | Cancelar a partir da venda muda o status; cancelamento avulso é só informativo e exibe aviso |
| Estorno contado duas vezes | Um lançamento, dois efeitos; o efeito em dinheiro só existe se a forma for dinheiro |
| Clique duplo ou reenvio do formulário | Chave de idempotência única por sessão; aviso de possível duplicidade (mesmo pedido, canal, forma e valor) |
| Linhas de bandeira ou plataforma somadas além do grupo | São decomposição; invariante "soma das linhas = faturamento" |
| Fechamento duplicado ao reenviar e-mail | E-mail é outra tabela; reenvio não cria fechamento; fechamento é único por sessão |
| Fechamento simultâneo por duas pessoas | Trava de linha (`SELECT ... FOR UPDATE`) e checagem de status na transação |
| Faltas e sobras que se anulam | Divergência absoluta e status `MISTO` |
| Relatório do período somando fechamento e movimentações | Relatórios leem apenas as movimentações; o fechamento guarda a foto do momento |

## 4. Banco de dados

Tabelas (nomes no plural, valores em centavos):

| Tabela | Conteúdo |
|---|---|
| `restaurants` | restaurante |
| `roles` | ADMIN, MANAGER, OPERATOR |
| `users` | usuários, senha com hash, tentativas falhas, bloqueio |
| `auth_sessions` | sessões de login (guarda só o hash do token) |
| `cash_registers` | caixas |
| `shifts` | turnos |
| `sales_channels` | canais de venda |
| `payment_methods` | formas de pagamento, cada uma com um `kind` (dinheiro, crédito, débito, PIX, ticket, online, outros) |
| `ticket_brands` | bandeiras de ticket |
| `cash_sessions` | abertura: caixa, turno, data, responsável, fundo, modo do fundo, status |
| `cash_movements` | livro-razão: vendas, suprimentos, sangrias, despesas, estornos e ajustes, com os dois efeitos |
| `cancellations` | pedidos cancelados, ligados à venda quando existir |
| `closing_conferences` | uma linha por item conferido, com sistema, esperado, conferido e diferença |
| `cash_closings` | fechamento: totais, divergência, justificativa, observação, revisão e foto completa em JSON |
| `closing_details` | matriz canal x forma e totais por tipo, congelados no fechamento |
| `adjustments` | toda alteração de campo: anterior, novo, campo, usuário, data, motivo |
| `audit_logs` | trilha de auditoria, apenas inserção |
| `email_logs` | cada tentativa de envio, com status e erro |
| `settings` | fundo padrão, tolerância, modo do fundo, destinatários, remetente |

Correspondência com a lista do pedido: `transactions` e `orders` são representadas por `cash_movements` do tipo VENDA (o número do pedido é um campo; uma venda paga em duas formas vira duas linhas com o mesmo número). Um livro-razão único evita o erro clássico de duas tabelas somadas em duplicidade.

Garantias no próprio banco: CHECK de valor positivo e de efeitos entre -1 e 1; índice único (caixa, turno, data); `audit_logs` e `adjustments` rejeitam UPDATE e DELETE por gatilho; nenhuma venda ou cancelamento é apagado, apenas muda de status com motivo.

## 5. Fluxo do caixa

```
Login -> escolher caixa e turno -> abrir caixa (fundo padrão R$ 100,00, modo do fundo)
  -> lançar vendas e movimentações (com cancelamento e estorno)
  -> conferir dinheiro, cartões, PIX, tickets e plataformas
  -> motor calcula tudo e mostra divergência com origem
  -> justificativa (se acima da tolerância) e observação
  -> fechar caixa (grava fechamento, foto e auditoria na mesma transação)
  -> relatório, CSV, e-mail (separado do fechamento, com reenvio)
```

Contagem do dinheiro por cédula e moeda (opcional): na conferência, a pessoa informa quantas peças de cada valor há na gaveta (R$ 200 a 1 centavo) e o sistema soma. Com a contagem ligada, o dinheiro conferido é a soma dela; o servidor recusa se os dois não baterem. A contagem fica em `closing_conferences.breakdown` (linha `cash`), entra na foto do fechamento e aparece no relatório, no e-mail e na impressão. Mudança de contagem em correção exige motivo e vira registro em `adjustments`.

Alerta de divergência: em Configurações, o administrador define quem recebe e a partir de qual soma das diferenças (vazio usa a tolerância). Depois que o caixa fecha, o sistema manda um e-mail curto com resultado, origem da diferença, justificativa e link do relatório. O envio roda depois da resposta (`after` do Next), então o fechamento nunca espera nem depende dele. Um alerta por revisão do fechamento; envio e falha ficam na auditoria (`alert.divergence.sent` / `alert.divergence.failed`).

Resumo semanal: toda segunda às 08:00 (horário de Brasília), um Cron da Vercel (`vercel.json`) chama `/api/cron/resumo-semanal`, que só aceita o cabeçalho `Authorization: Bearer <CRON_SECRET>`. Para cada restaurante com destinatários em Configurações, manda o resumo da semana anterior (segunda a domingo, só caixas fechados): faturamento com comparação à semana de antes, por forma, canal e turno, conferência, maiores diferenças, diferenças por responsável, cancelamentos e caixas que ficaram sem fechar. Uma vez por semana e por restaurante (`report.weekly.sent` na auditoria). O botão "Enviar agora" em Configurações manda na hora, para testar ou reenviar.

Estados da sessão: `OPEN` -> `CLOSED` -> `REOPENED` (gerente, motivo obrigatório) -> `CORRECTED` (fechada de novo após correção). `CORRECTED` pode ser reaberta outra vez. Sessão fechada não aceita nenhuma alteração.

## 6. Telas

Login; Dashboard; Caixa (abrir e escolher); Sessão (resumo, lançamentos, matriz, conferência, fechamento); Relatório do turno; Fechamento geral do dia; Relatórios gerenciais; Histórico de fechamentos e relatório completo; Divergências; Cancelamentos; Auditoria; Configurações (caixas, turnos, canais, formas de pagamento, tickets, fundo, tolerância, e-mail); Usuários.

A tela de fechamento do operador segue o desenho do pedido: fundo, dinheiro, cartão, PIX, tickets, cancelamentos, sangrias, faturamento, fundo, divergência, observação e os botões Conferir, Fechar caixa, Gerar relatório, Exportar CSV e Enviar por e-mail.

## 7. Relatórios

Relatório do turno, consolidado do dia, relatórios gerenciais (dia, semana, mês, período, turno, funcionário, plataforma, forma de pagamento, caixa, divergências), histórico com relatório completo, impressão/PDF pelo navegador e anexo HTML por e-mail. Os relatórios fechados usam a foto gravada no fechamento. Os relatórios de período usam as movimentações das sessões fechadas.

## 8. Permissões (RBAC)

| Permissão | Operador | Gerente | Administrador |
|---|---|---|---|
| Abrir caixa, lançar, conferir, fechar, relatório/CSV/e-mail da própria sessão | sim | sim | sim |
| Ver relatórios, histórico, dashboard geral, divergências, cancelamentos | não | sim | sim |
| Reabrir e corrigir fechamento, corrigir fundo | não | sim | sim |
| Exportar CSV geral | não | sim | sim |
| Usuários, catálogos, configurações, auditoria | não | não | sim |

O operador acessa sessões abertas ou reabertas, e as que ele mesmo abriu ou fechou. Toda ação é checada no servidor.

## 9. Auditoria

Registrados: login (sucesso e falha), logout, abertura, cada venda e movimentação (criação, edição, anulação), cancelamento, sangria, suprimento, conferência, fechamento, reabertura, correção, exportação e envio de relatório, além de mudanças de usuário e de configuração. Cada registro guarda usuário, ação, registro afetado, valor anterior, valor novo, data e hora, motivo e IP. Alterações de campo também entram em `adjustments`, com campo, valor anterior e novo. Nada financeiro é sobrescrito sem deixar rastro.

## 10. Segurança

Senha com bcrypt; token de sessão aleatório de 256 bits, guardado só como hash no banco, em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção; bloqueio temporário após tentativas falhas; Server Actions com verificação de origem do Next; cabeçalhos de segurança; todo SQL via Prisma (parametrizado); CSV protegido contra injeção de fórmula; todo HTML de relatório escapa o texto digitado.

## 11. Integrações com plataformas (iFood, fase 1)

Só leitura, para conferência. Tabelas `platform_integrations` (configuração por restaurante, sem credenciais), `platform_orders` (pedido como a plataforma informou, em centavos, com o JSON original) e `platform_events` (cada evento uma vez só). As credenciais ficam em variáveis de ambiente.

Sincronização idempotente: busca os eventos, grava cada um uma vez, busca o detalhe dos pedidos novos, grava, e só então confirma os eventos ao iFood. Pedido cuja leitura falhou não tem o evento confirmado e volta na rodada seguinte. Status só avança; cancelado vence tudo e não é apagado. O código do evento vale curto (`CFM`), por extenso (`CONFIRMED`) ou completo (`ORDER_CONFIRMED`); `CANCELLATION_REQUESTED` e `CANCELLATION_REQUEST_FAILED` não cancelam o pedido. Quando o detalhe do pedido traz o próprio status, ele entra na mesma regra de "só avança".

A documentação do iFood mostra duas rotas de eventos (módulo Events e página Endpoints do Order), com formatos de resposta e de confirmação diferentes. O cliente aceita as duas: tenta a do módulo Events e, se o aplicativo não tiver acesso a ela (403, 404, 405), usa a do Order e guarda a escolha. `IFOOD_EVENTS_ROUTE` fixa a rota.

O pedido entra no dia de negócio e no turno pela hora local; pedido de madrugada, antes do primeiro turno, fica no último turno do dia anterior. Na conferência, "pago no app" é comparado com as vendas online do canal iFood; pagamento na entrega aparece à parte, porque já entra na conferência de dinheiro, cartão ou ticket. A fase 2 (lançar os pedidos no caixa automaticamente) só depois de a fase 1 bater com o painel do iFood por alguns dias.
