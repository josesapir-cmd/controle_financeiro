#!/usr/bin/env node
/**
 * Quais campos de valor a Pluggy manda numa posicao de investimento.
 *
 * A carteira mostra `balance`, e a pergunta que trouxe este script foi: num
 * fundo, `balance` e o valor bruto ou o liquido de imposto? Fundo de renda
 * fixa e multimercado sofrem come-cotas, entao a diferenca existe e e a pessoa
 * que olha a tela que percebe primeiro.
 *
 * Eu NAO vou adivinhar o nome do campo. Ja errei assim antes neste projeto —
 * chutei `productType` em /loans e o script imprimiu "(sem productType) x11",
 * que se le como "o banco nao informou" e queria dizer "eu inventei o nome".
 * Aqui os campos saem da propria resposta.
 *
 * Imprime, para cada posicao: todos os campos numericos com seus valores, e a
 * lista de todos os campos. Nome do papel sai junto porque sem ele nao da para
 * conferir contra o aplicativo da corretora — e o dado ja esta na sua tela.
 *
 * Uso:
 *   node scripts/inspecionar-fundo.mjs                 # todas as conexoes
 *   node scripts/inspecionar-fundo.mjs btg             # so as que casam
 *   node scripts/inspecionar-fundo.mjs --tipo MUTUAL_FUND
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

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
          process.env[chave] = limpa
            .slice(igual + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

/** Sem acento e sem caixa: "Itaú" tem que casar com "itau". */
const simples = (t) =>
  t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

await lerEnv();

const argumentos = process.argv.slice(2);
const tipoPedido = argumentos.includes("--tipo")
  ? argumentos[argumentos.indexOf("--tipo") + 1]?.toUpperCase()
  : null;
const filtro = argumentos.find((a) => !a.startsWith("--") && a !== tipoPedido);

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

async function pedir(caminho) {
  const resposta = await fetch(`${API}${caminho}`, { headers: cabecalho });
  if (!resposta.ok) return { erro: `HTTP ${resposta.status}` };
  return { dados: await resposta.json() };
}

const { dados: itens, erro } = await pedir("/items");
if (erro) {
  console.error(`/items respondeu ${erro}.`);
  process.exit(1);
}

const lista = (itens?.results ?? []).filter(
  (i) => !filtro || simples(i.connector?.name ?? "").includes(simples(filtro)),
);

if (lista.length === 0) {
  console.log(filtro ? `Nenhuma conexao casa com "${filtro}".` : "Nenhuma conexao.");
  process.exit(0);
}

let achou = 0;

for (const item of lista) {
  const { dados, erro: e } = await pedir(`/investments?itemId=${item.id}`);
  if (e) {
    console.log(`\n━━ ${item.connector?.name}: ${e}`);
    continue;
  }

  const papeis = (dados?.results ?? []).filter(
    (p) => !tipoPedido || p.type === tipoPedido || p.subtype === tipoPedido,
  );

  if (papeis.length === 0) continue;

  console.log(`\n━━ ${item.connector?.name} — ${papeis.length} posicao(oes)\n`);

  for (const papel of papeis) {
    achou += 1;
    console.log(`  ${papel.name ?? "(sem nome)"}  [${papel.type}/${papel.subtype ?? "-"}]`);

    // So os campos numericos, e todos eles. E entre eles que esta o bruto.
    const numeros = Object.entries(papel)
      .filter(([, v]) => typeof v === "number")
      .sort(([a], [b]) => a.localeCompare(b));

    for (const [campo, valor] of numeros) {
      console.log(
        `     ${campo.padEnd(24)} ${valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`,
      );
    }

    // Objetos aninhados costumam guardar imposto e taxa; so os nomes, para
    // saber onde olhar sem despejar a resposta inteira.
    const aninhados = Object.entries(papel)
      .filter(([, v]) => v && typeof v === "object")
      .map(([k, v]) => `${k}{${Object.keys(v).sort().join(",")}}`);

    if (aninhados.length) console.log(`     aninhados: ${aninhados.join("  ")}`);
    console.log(`     todos os campos: ${Object.keys(papel).sort().join(", ")}`);
    console.log();
  }
}

if (achou === 0) {
  console.log(
    tipoPedido
      ? `\nNenhuma posicao de tipo ou subtipo "${tipoPedido}".`
      : "\nNenhuma posicao de investimento nas conexoes consultadas.",
  );
}
