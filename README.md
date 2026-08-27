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

## Deploy

Passo a passo em [docs/deploy.md](docs/deploy.md). Decisoes e razoes em
[docs/arquitetura.md](docs/arquitetura.md).

## Telas

| Rota | O que mostra |
| --- | --- |
| `/` | Painel do mes: patrimonio liquido, entradas, saidas, contas, gastos por categoria, lancamentos |
| `/dia` | Linha do tempo de um dia, com horario local — util para reconhecer uma compra que a descricao nao explica |
| `/contrapartes` | Quem recebe e quem envia dinheiro, com janela selecionavel e cadastro de categoria por contraparte |
| `/conexoes` | Cadastro dos itemIds das conexoes do Meu Pluggy |

## Decisoes que valem conhecer

**Tema claro fixo.** O app nao acompanha a preferencia de tema do sistema. O
`color-scheme: light` no `:root` e necessario: sem ele, os controles nativos
(campos de data, caixas de selecao, barra de rolagem) seguiriam o tema escuro do
sistema e destoariam da pagina.

**Fuso horario.** A Pluggy devolve datas em UTC com horario. Brasilia e UTC-3,
entao extrair o dia cortando a string ISO joga toda transacao apos as 21h para o
dia seguinte — e, na virada do mes, para o mes seguinte. Toda comparacao de data
passa por `src/lib/finance/dates.ts`. Para outro fuso, defina `APP_TIMEZONE`.

**Movimentacao nao e gasto.** Aplicacao em CDB, transferencia entre contas
proprias e pagamento de fatura saem do total de despesas e aparecem a parte. Sem
isso, um unico aporte esmaga todas as categorias do grafico.

**PII.** O bloco `paymentData` de cada transacao carrega o CPF do proprio
usuario. Na fronteira do servico guardamos apenas nome e documento da
contraparte; o resto e descartado antes de seguir adiante. Os arquivos em
`data/` ficam fora do versionamento.

## Configuracao

```bash
cp .env.example .env.local   # preencha as credenciais e os itemIds
npm install
npm run dev                  # sobe na porta 3210
```

### Cadastrando as conexoes

Abra `/conexoes` no app e cole a URL da conexao no Meu Pluggy
(`meu.pluggy.ai/connections/<itemId>`) — o id e extraido e guardado em
`data/items.json`, fora do controle de versao.

E manual por limitacao da API, nao por escolha: com credenciais pessoais, as
rotas de listagem respondem 403 (`/v2/items`, `/connections`, `/v2/connections`)
e nao existe rota que enumere as conexoes da conta.

Alternativa: `PLUGGY_ITEM_IDS` no `.env.local`, separados por virgula. Conexoes
definidas por ali aparecem na tela como somente leitura.

O `.env.local` esta no `.gitignore`. Nenhuma credencial deve ser commitada.

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | Servidor de desenvolvimento em http://localhost:3210 |
| `npm run dev -- -p 4000` | Idem, em outra porta |
| `npm run build` | Build de producao |
| `npm run typecheck` | Checagem de tipos |
| `npm test` | Testes |
