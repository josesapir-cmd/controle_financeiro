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

  // Sempre, e nao so quando esta ruim: um item UPDATED com executionStatus
  // PARTIAL_SUCCESS coletou parte dos produtos e falhou no resto — a lista
  // curta seria de coleta incompleta, nao de carteira pequena. E a data da
  // ultima coleta separa "nao tenho" de "ainda nao buscou".
  console.log(
    `  status: ${item.dados?.status ?? "?"}` +
      ` · execucao: ${item.dados?.executionStatus ?? "?"}` +
      ` · coletado em: ${String(item.dados?.lastUpdatedAt ?? "nunca").slice(0, 19)}`,
  );
  if (item.dados?.statusDetail) {
    // Detalhe por produto: e aqui que aparece "investimentos falhou".
    console.log(`  detalhe: ${JSON.stringify(item.dados.statusDetail)}`);
  }

  // Os campos do proprio item: e onde apareceria um `products` ou `consent`
  // dizendo o que ESTE vinculo autorizou, que nao e o mesmo que o conector
  // sabe fazer. Uma lista vazia por falta de escopo e indistinguivel de uma
  // lista vazia por nao ter o produto, e as duas exigem acoes opostas.
  console.log(`  campos do item: ${Object.keys(item.dados ?? {}).sort().join(", ")}`);
  if (Array.isArray(item.dados?.products)) {
    console.log(`  produtos autorizados: ${item.dados.products.join(", ") || "(vazio)"}`);
  }

  // Financiamento pode nao estar em /loans: no Open Finance ele as vezes chega
  // como CONTA, com subtipo proprio. Como o app so entende BANK e CREDIT, uma
  // conta de financiamento estaria sendo ignorada em silencio.
  const contas = await pedir(`/accounts?itemId=${item_id}`);
  if (contas.erro) {
    console.log(`  contas: ${contas.erro}`);
  } else {
    const lista = contas.dados?.results ?? [];
    console.log(`  contas: ${lista.length}`);
    for (const conta of lista) {
      console.log(
        `    · ${conta.type ?? "?"}/${conta.subtype ?? "-"} — ${conta.name ?? "(sem nome)"}` +
          (conta.marketingName && conta.marketingName !== conta.name
            ? ` (${conta.marketingName})`
            : ""),
      );
    }
  }

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

    // Um a um quando sao poucos: com uma lista curta, a pergunta deixa de ser
    // "quantos" e passa a ser "esses sao todos?" — e so o nome responde.
    if (rotulo === "investimentos" && lista.length <= 12) {
      for (const papel of lista) {
        console.log(
          `    · ${papel.type}/${papel.subtype ?? "-"} — ${papel.name ?? "(sem nome)"}` +
            (papel.institution?.name ? ` @ ${papel.institution.name}` : ""),
        );
      }
    }

    // Contamos so os campos que EXISTEM: um nome chutado devolveria
    // "(sem X) xN", que se le como "o banco nao informou" e nao e isso.
    for (const campo of chaves) {
      if (!(campo in lista[0])) continue;
      const resumo = contar(lista, campo);
      if (resumo) console.log(`    ${campo}: ${resumo}`);
    }

    console.log(`    campos: ${campos(lista)}`);

    // A garantia e o que separa financiamento imobiliario de credito pessoal:
    // o imovel entra em `warranties`. Sem ela, o contrato e sem garantia real,
    // qualquer que seja o nome comercial do produto.
    if (rotulo === "emprestimos") {
      for (const contrato of lista) {
        const garantias = Array.isArray(contrato.warranties) ? contrato.warranties : [];
        const tipos = garantias.map((g) => g?.type ?? "(sem tipo)").join(", ");
        console.log(
          `    · ${contrato.productName ?? contrato.type ?? "(sem nome)"}` +
            ` — ${garantias.length ? `garantia: ${tipos}` : "sem garantia"}` +
            (contrato.contractDate ? ` — contratado em ${String(contrato.contractDate).slice(0, 10)}` : ""),
        );
      }
    }
  }

  // No Open Finance, credito nao e uma coisa so: emprestimo, financiamento,
  // adiantamento a depositante e direitos creditorios sao COLECOES separadas.
  // /loans pode cobrir so a primeira. Perguntar as outras e a unica forma de
  // saber — a rota que nao existe responde 404, e isso ja e resposta.
  const outras = [];
  for (const rota of [
    "financings",
    "credit-operations",
    "unarranged-accounts-overdraft",
    "invoice-financings",
    // Controle. Esta rota nao existe, e e para isso que ela serve: sem ela,
    // um 403 nas quatro de cima pode ser "existe e voce nao tem acesso" ou
    // "e assim que a API responde a qualquer caminho desconhecido". As duas
    // leituras levam a acoes opostas — pedir o produto a Pluggy, ou desistir.
    "rota-que-nao-existe-controle",
  ]) {
    const resposta = await fetch(`${API}/${rota}?itemId=${item_id}`, { headers: cabecalho });

    if (!resposta.ok) {
      const corpo = await resposta.json().catch(() => null);
      const recado = corpo?.message || corpo?.code || corpo?.error || "";
      outras.push(`${rota}: HTTP ${resposta.status}${recado ? ` — ${recado}` : ""}`);
      continue;
    }

    const corpo = await resposta.json().catch(() => null);
    const lista = corpo?.results ?? [];
    outras.push(`${rota}: ${lista.length}`);
    for (const item of lista) {
      console.log(`    · [${rota}] ${item.productName ?? item.type ?? "(sem nome)"}`);
    }
    if (lista.length > 0) console.log(`    campos de ${rota}: ${campos(lista)}`);
  }

  console.log("  outras rotas de credito:");
  for (const linha of outras) console.log(`    ${linha}`);
}

await banco.fim();
console.log("");
