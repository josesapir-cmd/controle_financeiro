# Controle Financeiro

App de gestao financeira pessoal com dados de Open Finance via Pluggy.

## Estado atual

Fundacao do projeto (Next.js 16 + TypeScript). A camada de acesso a dados esta
sendo definida — ver "Como os dados chegam" abaixo.

## Como os dados chegam

Os dados vem do **Meu Pluggy** — a oferta gratuita de Open Finance da Pluggy para
uso pessoal. As contas sao conectadas no dashboard (https://meu.pluggy.ai) e lidas
pela API REST (`https://api.pluggy.ai`) com as credenciais do projeto.

O **MCP da Pluggy** (`docs.pluggy.ai/mcp`) NAO transporta dados financeiros: ele da
a um agente de codigo acesso a documentacao e a referencia da API em tempo de
execucao, junto com as Pluggy Skills. E ferramenta de desenvolvimento, nao fonte
de dados. Confundir os dois custou uma volta neste projeto.

### O que foi verificado contra a API

| Chamada | Resultado | Leitura |
| --- | --- | --- |
| `POST /auth` | 200 + JWT | Credenciais do Meu Pluggy valem na API publica |
| `GET /connectors` | 200 | A apiKey e aceita em endpoints de dados |
| `GET /accounts` (sem `itemId`) | 400 | Esperado — o parametro e obrigatorio |
| `GET /items` | 401 | **Inconclusivo**: provavelmente nao existe como rota de
  listagem (a API expoe `GET /items/{id}`), e o gateway responde 401 para rota
  nao reconhecida. Nao tome isso como ausencia de permissao. |

Como a API nao lista items, o `itemId` de cada conexao vem do dashboard do Meu
Pluggy e precisa ser guardado pela aplicacao.

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
