# Controle Financeiro

App de gestao financeira pessoal com dados de Open Finance via Pluggy.

## Estado atual

Fundacao do projeto (Next.js 16 + TypeScript). A camada de acesso a dados esta
sendo definida — ver "Como os dados chegam" abaixo.

## Como os dados chegam

Dados pessoais no Meu Pluggy **nao** sao acessiveis pela API REST publica com
credenciais de aplicacao. Isso foi verificado na pratica:

| Chamada | Resultado | Leitura |
| --- | --- | --- |
| `POST /auth` | 200 + JWT | Credenciais sao validas na API publica |
| `GET /connectors` | 200 | A apiKey e aceita em endpoints de dados |
| `GET /items` | 401 | Conexoes feitas no Meu Pluggy nao sao listaveis |
| `GET /accounts` | 400 | Esperado — exige `itemId` |
| `POST /connect_token` | 200 + accessToken | Endpoint responde, mas **nao** implica
  autorizacao para dados pessoais |

A Pluggy orientou, por e-mail, que o caminho para dados pessoais e conectar as
contas no Meu Pluggy e consumi-las pelo servidor MCP deles — nao pelo widget
Pluggy Connect com credenciais proprias.

Consequencia de projeto: o acesso a dados fica atras de uma interface
(`src/lib/pluggy/`), com implementacao intercambiavel. Os tipos em `types.ts`
descrevem o modelo de dados da Pluggy e valem para qualquer transporte.

## Configuracao

```bash
cp .env.example .env.local   # preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET
npm install
npm run dev
```

O `.env.local` esta no `.gitignore`. Nenhuma credencial deve ser commitada.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento |
| `npm run build` | Build de producao |
| `npm run typecheck` | Checagem de tipos |
| `npm test` | Testes |
