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

## 4. Conferir a sincronizacao automatica

O cron roda a cada 6 horas. Para testar na hora, do seu terminal:

```bash
APP_ORIGIN=https://SEU-DOMINIO npm run sync 45
```

Em Vercel → Deployments → Functions da para ver as execucoes agendadas.

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
