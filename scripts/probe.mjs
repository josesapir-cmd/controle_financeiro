#!/usr/bin/env node
/**
 * Sonda a API da Pluggy usando as credenciais e as conexoes que o proprio
 * projeto ja conhece — le .env.local e data/items.json, sem pedir nada colado
 * a mao.
 *
 * Uso: node scripts/probe.mjs [produto ...]
 *   node scripts/probe.mjs                 # visao geral de todas as conexoes
 *   node scripts/probe.mjs loans           # so financiamentos
 *   node scripts/probe.mjs loans investments
 *
 * Nao imprime documentos nem numeros de conta: a saida pode ser colada.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

const RAIZ = process.cwd();
const API = process.env.PLUGGY_API_URL || "https://api.pluggy.ai";

/** Produtos consultados por padrao, todos no formato /<produto>?itemId= */
const PRODUTOS_PADRAO = ["accounts", "loans", "investments", "identity"];

async function lerEnv() {
  const valores = { ...process.env };
  for (const arquivo of [".env.local", ".env"]) {
    try {
      const conteudo = await readFile(path.join(RAIZ, arquivo), "utf8");
      for (const linha of conteudo.split("\n")) {
        const limpa = linha.trim();
        if (!limpa || limpa.startsWith("#")) continue;
        const igual = limpa.indexOf("=");
        if (igual === -1) continue;
        const chave = limpa.slice(0, igual).trim();
        // Variavel ja definida no ambiente tem precedencia sobre o arquivo.
        if (valores[chave] === undefined || valores[chave] === "") {
          valores[chave] = limpa.slice(igual + 1).trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {
      // Arquivo ausente e normal: as credenciais podem vir so do ambiente.
    }
  }
  return valores;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function lerItemIds(env) {
  const ids = new Set();

  for (const id of (env.PLUGGY_ITEM_IDS || "").split(",")) {
    const limpo = id.trim();
    if (UUID.test(limpo)) ids.add(limpo);
  }

  try {
    const conteudo = await readFile(path.join(RAIZ, "data", "items.json"), "utf8");
    for (const id of JSON.parse(conteudo).itemIds ?? []) {
      if (UUID.test(id)) ids.add(id);
    }
  } catch {
    // Sem conexoes cadastradas pela interface; seguimos com o que veio do env.
  }

  return [...ids];
}

async function autenticar(env) {
  const resposta = await fetch(`${API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId: env.PLUGGY_CLIENT_ID,
      clientSecret: env.PLUGGY_CLIENT_SECRET,
    }),
  });

  if (!resposta.ok) {
    console.error(`Falha ao autenticar: HTTP ${resposta.status}`);
    console.error(await resposta.text());
    process.exit(1);
  }

  return (await resposta.json()).apiKey;
}

async function buscar(caminho, apiKey) {
  const resposta = await fetch(`${API}${caminho}`, { headers: { "X-API-KEY": apiKey } });
  const texto = await resposta.text();
  let corpo = null;
  try {
    corpo = JSON.parse(texto);
  } catch {
    corpo = texto;
  }
  return { status: resposta.status, corpo };
}

/** Resumo de um registro sem expor documento, numero de conta ou nome de pessoa. */
function resumir(registro) {
  if (!registro || typeof registro !== "object") return String(registro);

  const interessantes = [
    "id", "type", "subtype", "name", "contractNumber", "contractCode", "number",
    "productName", "loanType", "amount", "balance", "totalAmount", "outstandingBalance",
    "installmentPeriodicity", "totalInstallments", "paidInstallments", "dueDate",
    "interestRate", "cet", "status", "currencyCode",
  ];

  const partes = [];
  for (const campo of interessantes) {
    const valor = registro[campo];
    if (valor === null || valor === undefined || typeof valor === "object") continue;
    partes.push(`${campo}=${valor}`);
  }

  const extras = Object.keys(registro).filter(
    (k) => !interessantes.includes(k) && registro[k] !== null && registro[k] !== undefined,
  );

  return `${partes.join(" · ")}${extras.length ? `\n      outros campos: ${extras.join(", ")}` : ""}`;
}

const produtos = process.argv.slice(2).length ? process.argv.slice(2) : PRODUTOS_PADRAO;

const env = await lerEnv();
if (!env.PLUGGY_CLIENT_ID || !env.PLUGGY_CLIENT_SECRET) {
  console.error("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET nao encontrados no .env.local.");
  process.exit(1);
}

const itemIds = await lerItemIds(env);
if (itemIds.length === 0) {
  console.error("Nenhuma conexao cadastrada. Adicione em /conexoes ou em PLUGGY_ITEM_IDS.");
  process.exit(1);
}

const apiKey = await autenticar(env);
console.log(`${itemIds.length} ${itemIds.length === 1 ? "conexao" : "conexoes"} · produtos: ${produtos.join(", ")}\n`);

for (const itemId of itemIds) {
  const item = await buscar(`/items/${itemId}`, apiKey);
  const conector = item.corpo?.connector;
  const nome = conector?.name ?? "(item nao legivel)";

  console.log(`━━ ${nome}  [${itemId.slice(0, 8)}…]`);
  if (conector?.products) console.log(`   produtos do conector: ${conector.products.join(", ")}`);
  if (item.status !== 200) console.log(`   GET /items/{id} -> HTTP ${item.status}`);

  for (const produto of produtos) {
    const { status, corpo } = await buscar(`/${produto}?itemId=${itemId}`, apiKey);
    const resultados = corpo?.results;

    if (status !== 200) {
      console.log(`   ${produto}: HTTP ${status} ${corpo?.message ? `— ${corpo.message}` : ""}`);
      continue;
    }
    if (!Array.isArray(resultados) || resultados.length === 0) {
      console.log(`   ${produto}: vazio`);
      continue;
    }

    console.log(`   ${produto}: ${resultados.length}`);
    for (const registro of resultados) {
      console.log(`    · ${resumir(registro)}`);
    }
  }
  console.log("");
}
