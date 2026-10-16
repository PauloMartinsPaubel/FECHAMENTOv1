# Programa da Eclética

Este programa fica no mesmo computador Windows do Eclética B.I. Ele lê a cópia do banco que o B.I mantém (o MySQL local, não o sistema em produção) e manda para o Fechamento de Caixa os turnos fechados, com vendas, formas de pagamento, canais, cancelamentos e sangrias. Ele só lê o banco e só envia, pela internet com HTTPS, para o endereço do sistema. Nada no MySQL fica aberto para a internet, e dados de cliente (nome, telefone, CPF, endereço) não são lidos nem enviados.

Cada turno vai inteiro. Se uma venda for cancelada ou alterada depois, o turno vai de novo e substitui o que estava no sistema. Os turnos fechados dos últimos dias (3, por padrão) são conferidos a cada envio, e só o que mudou é mandado.

## O que precisa

Windows 10 ou mais novo, o Eclética B.I já instalado pela Eclética e o Node.js versão LTS (baixe em nodejs.org e instale com as opções padrão).

## Instalação

1. Copie esta pasta para `C:\fechamento\agente-ecletica` (um caminho sem espaços evita problema com o agendador do Windows).
2. Abra o Prompt de Comando nessa pasta e rode `npm ci`. Isso baixa a única peça de fora que o programa usa, o acesso ao MySQL.
3. No Fechamento de Caixa, entre como administrador, vá em Integrações, no quadro da Eclética, e clique em "Gerar chave do programa". A chave aparece uma vez só: copie na hora.
4. Copie `config.exemplo.json` para `config.json` e preencha:
   - `url`: deixe como está, a não ser que o sistema mude de endereço.
   - `chave`: a chave do passo 3.
   - `mysql`: endereço, porta, usuário e senha do MySQL do B.I. Use um usuário só de leitura (veja abaixo).
   - `bases`: o nome da base da loja (algo como `00012978ecleticaloja_bi`) e, se a Eclética ativar o tempo real, o nome da base de tempo real em `tempoReal`. A Eclética informa esses nomes na instalação.
   - `diasParaConferir`: quantos dias de turnos fechados o programa confere a cada envio.
5. Rode `node agente.mjs --testar`. Ele lê o banco e mostra quantos turnos e vendas encontrou e um exemplo, sem enviar nada.
6. Rode `node agente.mjs --uma-vez`. Ele envia e sai. Em Integrações, o quadro da Eclética passa a mostrar o último envio e os códigos de marca, canal e forma de pagamento recebidos.
7. Agende o envio automático (próxima seção).

## Usuário do MySQL só de leitura

A Eclética cria na instalação um usuário somente leitura. O mais seguro é que o usuário do programa enxergue só as seis tabelas que ele usa (`turnos`, `pagamentos`, `det_pagto`, `sangrias`, `detalhe` e `origens_vendas`), e não clientes, endereços, funcionários ou fornecedores. Depois de preencher `mysql.user`, `mysql.password` e `bases` no `config.json`, rode:

```
node agente.mjs --permissoes
```

Ele mostra os comandos para criar esse usuário com essas permissões. Quem administra o MySQL (o suporte da Eclética, se preferir) roda esses comandos com o usuário administrador do banco. A tela mostra a senha: feche a janela depois.

## Envio automático

O jeito mais simples é o Agendador de Tarefas do Windows rodar `enviar.bat` a cada 10 minutos, mesmo sem ninguém conectado. Abra o Prompt de Comando como administrador e rode:

```
schtasks /Create /TN "Fechamento Ecletica" /TR "C:\fechamento\agente-ecletica\enviar.bat" /SC MINUTE /MO 10 /RU SYSTEM
```

Cada execução lê, envia o que mudou e termina. Se uma der erro (internet fora, por exemplo), a próxima tenta de novo, e nada é marcado como enviado sem o sistema confirmar. Para enviar na hora, por exemplo depois de forçar o sincronismo do B.I, rode `enviar.bat` com dois cliques. Também dá para deixar `node agente.mjs` aberto numa janela; nesse caso ele envia a cada `intervaloMinutos`.

O B.I atualiza a cópia em ciclos (60 minutos, por padrão, e no mínimo 30), e o turno só chega depois de fechado no caixa da Eclética. Um envio a cada 10 minutos não deixa nada esperando além disso.

## Proteger o arquivo de configuração

O `config.json` tem a chave do programa e a senha do MySQL. Deixe só o sistema e os administradores lerem o arquivo, rodando no Prompt de Comando como administrador, dentro da pasta:

```
icacls config.json /inheritance:r /grant:r *S-1-5-18:F *S-1-5-32-544:F
```

Se a chave vazar ou o computador for trocado, gere outra em Integrações: a antiga para de valer na hora. Para pausar o recebimento sem apagar nada, use o botão de desligar no mesmo quadro.

## Onde ver o que aconteceu

O programa escreve em `agente.log`, nesta pasta (quando passa de 1 MB, o anterior vira `agente.log.antigo`). O `estado.json` guarda o que já foi enviado; apagar esse arquivo só faz o próximo envio mandar de novo os turnos dos últimos dias, sem duplicar nada no sistema. No Fechamento de Caixa, o quadro da Eclética em Integrações mostra o último envio, se deu certo e o que chegou nos últimos 7 dias.
