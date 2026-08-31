# Deploy na Vercel

Passo a passo para publicar. Rode na ordem: cada etapa depende da anterior.

## Antes de comecar

O banco (Neon) ja existe e ja tem dados — o deploy nao mexe nele. O que muda e
apenas de onde o app roda.

## 1. Criar o projeto

Em vercel.com, importe o repositorio `josesapir-cmd/controle_financeiro` e
escolha o branch `claude/pluggy-mcp-integration-1h0orz`.

Nao altere Framework Preset, Build Command nem Output Directory: a deteccao
automatica do Next.js esta correta. A regiao ja vem fixada em `gru1` (Sao Paulo)
pelo `vercel.json`, junto com o cron de sincronizacao a cada 6 horas.

**Nao faca o deploy ainda** — sem as variaveis abaixo, o build sobe um app que
nao conecta em nada.

## 2. Variaveis de ambiente

Em Settings → Environment Variables, marque **Production** e **Preview** em
todas:

| Variavel | Valor |
| --- | --- |
| `DATABASE_URL` | a mesma connection string do Neon do `.env.local` |
| `APP_ENCRYPTION_KEY` | **a mesma** do `.env.local` — ver aviso abaixo |
| `PLUGGY_CLIENT_ID` | do `.env.local` |
| `PLUGGY_CLIENT_SECRET` | do `.env.local` |
| `SYNC_SECRET` | do `.env.local` |
| `CRON_SECRET` | gere um novo: `openssl rand -hex 32` |
| `APP_DOMAIN` | o dominio da Vercel, sem protocolo (ex.: `controle-financeiro.vercel.app`) |
| `APP_ORIGIN` | a URL completa (ex.: `https://controle-financeiro.vercel.app`) |
| `ANTHROPIC_API_KEY` | do console.anthropic.com — so para ler prints do saldo compartilhado |

`ANTHROPIC_API_KEY` e opcional: sem ela todo o resto funciona e apenas o envio
de prints do saldo compartilhado responde erro, dizendo o que falta.

> **A chave de criptografia precisa ser a mesma.** Gerar outra nao da erro: o
> app sobe normalmente e devolve lixo ao tentar decifrar descricoes e
> contrapartes ja gravadas. O sintoma aparece longe da causa.

`APP_DOMAIN` e `APP_ORIGIN` so podem ser preenchidos depois do primeiro deploy,
quando a Vercel atribui o dominio. Faca o deploy, copie o dominio, preencha as
duas e mande **redeploy** — passkey nao funciona com dominio errado, por
desenho: e o que impede um site clonado de reaproveitar a credencial.

## 3. Primeiro acesso

Abra a URL. Como nao ha passkey registrada para esse dominio, o app oferece
criar a primeira.

O registro local e o de producao sao independentes: a passkey e vinculada ao
dominio. A do `localhost` nao vale em produção e vice-versa.

Guarde o codigo de recuperacao que aparece — ele e exibido uma unica vez.

Registre tambem o celular, abrindo a mesma URL nele. Depender de um unico
dispositivo e a forma mais comum de se trancar para fora.

## 4. Sincronizacao automatica

O plano gratuito da Vercel permite **uma execucao de cron por dia**. O
`vercel.json` ja esta configurado para 09:00 UTC — 06:00 em Brasilia, quando os
lancamentos da vespera ja liquidaram e o painel esta pronto ao acordar.

O `vercel.json` nao leva comentarios: a Vercel valida o esquema e recusa
qualquer chave desconhecida, inclusive a convencao `"//"`. As razoes das
escolhas ficam aqui.

Para sincronizar com mais frequencia sem pagar, o repositorio traz
`.github/workflows/sincronizar.yml`, que chama a mesma rota a cada 6 horas pelo
GitHub Actions. Para ativar, adicione dois segredos em **Settings → Secrets and
variables → Actions** do repositorio:

| Segredo | Valor |
| --- | --- |
| `APP_ORIGIN` | a URL do app publicado, com `https://` |
| `SYNC_SECRET` | o mesmo valor configurado na Vercel |

As duas fontes podem coexistir: a rota e idempotente, entao sincronizar duas
vezes nao duplica nada.

Para disparar na hora, use o botao **Sincronizar** na tela de conexoes, ou a aba
**Actions** do GitHub (o fluxo aceita execucao manual).

## Depois do deploy

O `.env.local` continua valendo para desenvolvimento: o app local e o publicado
compartilham o mesmo banco. Cuidado que isso implica — uma sincronizacao local
escreve nos dados de producao, porque sao os mesmos dados.

## Rotacao de segredos

Se um segredo vazar, o `PLUGGY_CLIENT_SECRET` e o mais urgente: com ele, um
terceiro puxa seus dados direto da Pluggy, sem passar pelo app. Rotacione no
painel da Pluggy e atualize nos dois lugares (Vercel e `.env.local`).

A `APP_ENCRYPTION_KEY` e a excecao: trocar exige reescrever tudo que ja foi
cifrado. Nao rotacione sem um plano de migracao.
