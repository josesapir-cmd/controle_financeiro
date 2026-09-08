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
/**
 * Sem acento e sem caixa, dos dois lados.
 *
 * O conector se chama "Itau" com acento e ninguem o digita na linha de
 * comando: comparar cru fazia o filtro descartar justamente a conexao pedida.
 */
function comparavel(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

const filtro = comparavel(process.argv[2] || "");

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

const escolhidas = conexoes.filter(
  (c) => !filtro || comparavel(c.connector_name).includes(filtro),
);

// Sair calado quando nada casa e o pior jeito de falhar: parece que a resposta
// e "nao ha nada", quando na verdade a pergunta nao chegou a ser feita.
if (escolhidas.length === 0) {
  console.log(`\nNenhuma conexao casa com "${process.argv[2]}".`);
  console.log(`Conexoes: ${conexoes.map((c) => c.connector_name).join(", ")}`);
  await banco.fim();
  process.exit(0);
}

let comCredito = 0;

for (const { item_id, connector_name } of escolhidas) {

  const contas = await fetch(`${API}/accounts?itemId=${item_id}`, { headers: cabecalho });
  if (!contas.ok) {
    console.log(`\n━━ ${connector_name}: contas HTTP ${contas.status}`);
    continue;
  }

  const lista = (await contas.json())?.results ?? [];
  const credito = lista.filter((c) => c.type === "CREDIT");
  if (credito.length === 0) {
    console.log(`\n━━ ${connector_name}: nenhuma conta de credito`);
    continue;
  }

  comCredito += credito.length;

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
      for (const campo of ["level", "brand", "holderType", "status"]) {
        if (conta.creditData[campo]) console.log(`      ${campo}: ${conta.creditData[campo]}`);
      }

      // O cadastro dos adicionais, quando o banco manda: e o que liga os
      // ultimos digitos que aparecem no lancamento a uma pessoa. Sem ele, da
      // para separar os cartoes mas nao para saber de quem e cada um.
      const adicionais = conta.creditData.additionalCards;
      if (Array.isArray(adicionais) && adicionais.length > 0) {
        console.log(`      additionalCards: ${adicionais.length}`);
        for (const cartao of adicionais) {
          console.log(`        · ${JSON.stringify(cartao)}`);
        }
      } else {
        console.log(`      additionalCards: ${adicionais ? JSON.stringify(adicionais) : "vazio"}`);
      }

      // Limite por cartao: outra forma de o banco nomear cada plastico.
      const limites = conta.creditData.disaggregatedCreditLimits;
      if (limites) console.log(`      disaggregatedCreditLimits: ${JSON.stringify(limites)}`);
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

if (comCredito === 0) {
  console.log("\nNenhuma conta de credito nas conexoes consultadas.");
}

await banco.fim();
console.log("");
