# Fechamento de Caixa para restaurante

Caixa, conferência, fechamento, relatórios, histórico, auditoria, CSV e e-mail. Next.js 15, TypeScript, PostgreSQL, Prisma 7, Tailwind 4, Zod.

As regras financeiras, o modelo de dados, as permissões e os riscos de dupla contabilização estão em [docs/ARQUITETURA.md](docs/ARQUITETURA.md).

## Rodar

```bash
cp .env.example .env          # ajuste DATABASE_URL e a senha do administrador
npm install
npx prisma migrate deploy     # cria as tabelas, CHECKs e gatilhos
npm run db:seed               # cadastros básicos e o administrador
npm run build && npm start    # ou: npm run dev
```

Primeiro acesso: o e-mail e a senha de `SEED_ADMIN_*`. O sistema pede troca de senha na entrada.

## E-mail

`EMAIL_PROVIDER=smtp` (com `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) ou `resend` (com `RESEND_API_KEY`). Sem isso o envio falha com aviso claro, o fechamento continua salvo e o botão Reenviar fica disponível. Destinatários em Configurações.

## Testes

```bash
createdb fechamento_test && DATABASE_URL=.../fechamento_test npx prisma migrate deploy
npm test        # 90 unitários + 60 de integração (PostgreSQL e SMTP locais)
```

Os testes de integração só rodam em banco cujo nome termina em `_test`.

## Limites conhecidos

- Não há integração com PDV: as vendas são lançadas por pedido ou em grade por canal e forma.
- PDF sai pela impressão do navegador; o anexo do e-mail é HTML.
- O bloqueio de tentativas de login é por usuário, não por IP. Em produção, ponha um limitador de taxa na frente.
- Sessão fora do HTTPS: defina `COOKIE_SECURE=false` só em rede interna.
