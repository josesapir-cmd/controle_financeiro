#!/usr/bin/env node
/**
 * O que cada conexao expoe alem de conta corrente e cartao.
 *
 * A pergunta que este script responde e "a Pluggy me traz fundo de
 * investimento e financiamento imobiliario?" — e ela nao tem resposta unica.
 * Depende de tres coisas ao mesmo tempo:
 *
 * 1. do produto existir na API (`/investments`, `/loans`);
 * 2. do CONECTOR daquele banco publicar aquele produto — a lista sai em
 *    `connector.products`;
 * 3. do consentimento do item cobrir aquele escopo, que e o que se marca na
 *    hora de conectar.
 *
 * Um "nao" em qualquer um dos tres da lista vazia, e os tres motivos exigem
 * acoes diferentes. Por isso o script imprime os tres, e nao so a contagem.
 *
 * Nao imprime valor nem saldo: so tipo, subtipo e quantidade. E para descobrir
 * o que da para construir, nao para ler carteira.
 *
 * Uso:
 *   node scripts/probe-produtos.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";

async function lerEnv() {
  for (const arquivo of [".env.local", ".env"]) {
    try {
      const conteudo = await readFile(path.join(process.cwd(), arquivo), "utf8");
      for (const linha of conteudo.split("\n")) {
        const limpa = linha.trim();
        if (!limpa || limpa.startsWith("#")) continue;
        const igual = limpa.indexOf("=");
        if (igual === -1) continue;
        const chave = limpa.slice(0, igual).trim();
        if (!process.env[chave]) {
          process.env[chave] = limpa.slice(igual + 1).trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

await lerEnv();
const API = process.env.PLUGGY_API_URL || "https://api.pluggy.ai";

if (!process.env.PLUGGY_CLIENT_ID || !process.env.PLUGGY_CLIENT_SECRET) {
  console.error("PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET nao definidos.");
  process.exit(1);
}

const auth = await fetch(`${API}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  }),
});

if (!auth.ok) {
  console.error(`/auth respondeu ${auth.status}. Confira as credenciais.`);
  process.exit(1);
}

const { apiKey } = await auth.json();
const cabecalho = { "X-API-KEY": apiKey };

/** Pede o recurso e diz o que aconteceu — inclusive o 403 de escopo. */
async function pedir(caminho) {
  const resposta = await fetch(`${API}${caminho}`, { headers: cabecalho });
  if (!resposta.ok) {
    let detalhe = "";
    try {
      const corpo = await resposta.json();
      detalhe = corpo?.message || corpo?.code || "";
    } catch {}
    return { erro: `HTTP ${resposta.status}${detalhe ? ` — ${detalhe}` : ""}` };
  }
  return { dados: await resposta.json() };
}

/**
 * Os nomes dos campos do primeiro registro, sem os valores.
 *
 * A primeira versao deste script contou `productType` em /loans e imprimiu
 * "(sem productType) x11" — que nao quer dizer "o banco nao informou", quer
 * dizer "eu chutei o nome do campo". Listar as chaves e o unico jeito de
 * descobrir a forma da resposta sem abrir o conteudo dela.
 */
function campos(itens) {
  const primeiro = itens[0];
  if (!primeiro || typeof primeiro !== "object") return "";
  return Object.keys(primeiro).sort().join(", ");
}

/** Conta por chave, para o resumo caber numa linha. */
function contar(itens, chave) {
  const mapa = new Map();
  for (const item of itens) {
    const valor = item?.[chave] ?? "(sem " + chave + ")";
    mapa.set(valor, (mapa.get(valor) ?? 0) + 1);
  }
  return [...mapa.entries()].map(([k, n]) => `${k} x${n}`).join(", ");
}

const banco = await abrirBanco();

let conexoes;
try {
  conexoes = await banco.query(
    "SELECT item_id, connector_name FROM connections ORDER BY connector_name",
  );
} catch (erro) {
  morrerComExplicacao(erro);
}

for (const { item_id, connector_name } of conexoes) {
  console.log(`\n━━ ${connector_name}  [${String(item_id).slice(0, 8)}…]`);

  const item = await pedir(`/items/${item_id}`);
  if (item.erro) {
    console.log(`  item: ${item.erro}`);
    continue;
  }

  // O que o conector diz que sabe fazer, antes de perguntar o que ele tem.
  const produtos = item.dados?.connector?.products ?? [];
  console.log(`  produtos do conector: ${produtos.length ? produtos.join(", ") : "(nao informado)"}`);

  const status = item.dados?.status;
  if (status && status !== "UPDATED") console.log(`  status do item: ${status}`);

  for (const [rotulo, caminho, chaves] of [
    ["investimentos", `/investments?itemId=${item_id}`, ["type", "subtype"]],
    // Sem palpite de nome aqui: as chaves saem da propria resposta, na linha
    // `campos:` abaixo.
    ["emprestimos", `/loans?itemId=${item_id}`, ["type", "subtype", "productType"]],
  ]) {
    const resposta = await pedir(caminho);
    if (resposta.erro) {
      console.log(`  ${rotulo}: ${resposta.erro}`);
      continue;
    }

    const lista = resposta.dados?.results ?? [];
    if (lista.length === 0) {
      console.log(`  ${rotulo}: nenhum`);
      continue;
    }

    console.log(`  ${rotulo}: ${lista.length}`);

    // Contamos so os campos que EXISTEM: um nome chutado devolveria
    // "(sem X) xN", que se le como "o banco nao informou" e nao e isso.
    for (const campo of chaves) {
      if (!(campo in lista[0])) continue;
      const resumo = contar(lista, campo);
      if (resumo) console.log(`    ${campo}: ${resumo}`);
    }

    console.log(`    campos: ${campos(lista)}`);
  }
}

await banco.fim();
console.log("");
