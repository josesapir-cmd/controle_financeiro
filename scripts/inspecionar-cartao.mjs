#!/usr/bin/env node
/**
 * O que distingue um cartao adicional dentro da mesma fatura.
 *
 * No Open Finance o adicional nao e uma conta: as compras dele entram na conta
 * do titular. Separar "meu" de "do meu pai" so e possivel se o lancamento
 * carregar algum campo do cartao — os ultimos digitos, o nome impresso, um
 * identificador. E isso que este script procura.
 *
 * Imprime, para cada conta de credito: os campos da conta que poderiam
 * identificar titularidade, e os VALORES DISTINTOS de `creditCardMetadata` nos
 * lancamentos recentes, com quantas vezes cada um aparece. Se sairem dois
 * valores num campo, e por ali que a separacao se faz.
 *
 * Nao imprime valor, descricao nem estabelecimento: a pergunta e sobre a forma
 * do dado, nao sobre o que foi comprado. Documento sai mascarado.
 *
 * Uso:
 *   node scripts/inspecionar-cartao.mjs             # todas as conexoes
 *   node scripts/inspecionar-cartao.mjs itau        # so as que casam com o texto
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
const filtro = (process.argv[2] || "").toLowerCase();

const auth = await fetch(`${API}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  }),
});

if (!auth.ok) {
  console.error(`/auth respondeu ${auth.status}.`);
  process.exit(1);
}

const { apiKey } = await auth.json();
const cabecalho = { "X-API-KEY": apiKey };

/** Documento so com os ultimos digitos: identifica sem expor. */
function mascarar(valor) {
  const texto = String(valor ?? "").replace(/\D/g, "");
  return texto ? `•••${texto.slice(-3)}` : "";
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
  if (filtro && !String(connector_name).toLowerCase().includes(filtro)) continue;

  const contas = await fetch(`${API}/accounts?itemId=${item_id}`, { headers: cabecalho });
  if (!contas.ok) {
    console.log(`\n━━ ${connector_name}: contas HTTP ${contas.status}`);
    continue;
  }

  const lista = (await contas.json())?.results ?? [];
  const credito = lista.filter((c) => c.type === "CREDIT");
  if (credito.length === 0) continue;

  console.log(`\n━━ ${connector_name}`);

  for (const conta of credito) {
    console.log(`\n  ${conta.name}${conta.marketingName ? ` (${conta.marketingName})` : ""}`);
    console.log(`    subtipo: ${conta.subtype ?? "-"}`);
    console.log(`    numero: ${conta.number ?? "(nao informado)"}`);
    console.log(`    titular: ${conta.owner ?? "(nao informado)"}`);
    console.log(`    documento: ${conta.taxNumber ? mascarar(conta.taxNumber) : "(nao informado)"}`);
    console.log(`    campos da conta: ${Object.keys(conta).sort().join(", ")}`);
    if (conta.creditData) {
      console.log(`    creditData: ${Object.keys(conta.creditData).sort().join(", ")}`);
      // `holderType` e `level` sao os campos onde titular x adicional apareceria.
      for (const campo of ["level", "brand", "holderType", "status"]) {
        if (conta.creditData[campo]) console.log(`      ${campo}: ${conta.creditData[campo]}`);
      }
    }

    // Uma pagina de lancamentos basta: a pergunta e se o campo EXISTE e se ele
    // varia, nao quantas compras cada cartao fez.
    const transacoes = await fetch(
      `${API}/v2/transactions?accountId=${encodeURIComponent(conta.id)}`,
      { headers: cabecalho },
    );

    if (!transacoes.ok) {
      console.log(`    lancamentos: HTTP ${transacoes.status}`);
      continue;
    }

    const resultados = (await transacoes.json())?.results ?? [];
    console.log(`    lancamentos na amostra: ${resultados.length}`);

    const porCampo = new Map();
    for (const t of resultados) {
      const meta = t.creditCardMetadata;
      if (!meta || typeof meta !== "object") continue;
      for (const [campo, valor] of Object.entries(meta)) {
        if (valor === null || valor === undefined || valor === "") continue;
        const chave = `${campo} = ${String(valor)}`;
        porCampo.set(chave, (porCampo.get(chave) ?? 0) + 1);
      }
    }

    if (porCampo.size === 0) {
      console.log("    creditCardMetadata: ausente em todos os lancamentos da amostra");
      continue;
    }

    console.log("    creditCardMetadata (valores distintos):");
    for (const [chave, n] of [...porCampo.entries()].sort()) {
      console.log(`      ${chave}  ×${n}`);
    }
  }
}

await banco.fim();
console.log("");
