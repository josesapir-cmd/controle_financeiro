#!/usr/bin/env node
/**
 * Quanto uma contraparte pagou, por ano e por mes.
 *
 * Nasceu de uma pergunta concreta — "quanto o Green FIDC amortizou em 2026?" —
 * que o painel nao responde: ele mostra despesa por categoria, nao a serie de
 * uma unica contraparte ao longo dos anos.
 *
 * A busca e pelo nome decifrado, entao a varredura e no cliente: o nome vai
 * cifrado no banco justamente para nao ser pesquisavel em SQL. Para o volume
 * de um extrato pessoal isso custa alguns segundos, e e o preco combinado.
 *
 * Uso:
 *   node scripts/recebidos.mjs "oliveira trust"
 *   node scripts/recebidos.mjs "oliveira trust" --ano 2026
 *   node scripts/recebidos.mjs "oliveira trust" --saidas   # o que saiu, nao o que entrou
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
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
          process.env[chave] = limpa
            .slice(igual + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

/** Sem acento e sem caixa: "Oliveira Trust" casa com "oliveira trust". */
function simplificar(texto) {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const dinheiro = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

await lerEnv();

const argumentos = process.argv.slice(2);
const busca = argumentos.find((a) => !a.startsWith("--"));
const saidas = argumentos.includes("--saidas");
const anoPedido = argumentos.includes("--ano")
  ? Number(argumentos[argumentos.indexOf("--ano") + 1])
  : null;

if (!busca) {
  console.error('Diga o que procurar: node scripts/recebidos.mjs "oliveira trust"');
  process.exit(1);
}

const alvo = simplificar(busca);
const chave = lerChaveDoAmbiente();
const banco = await abrirBanco().catch(morrerComExplicacao);

try {
  const linhas = await banco.query(
    `SELECT t.local_day, t.amount, t.description_enc, t.counterparty_name_enc,
            a.name_enc AS conta_enc, a.connector_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE ($1::boolean AND t.amount < 0) OR (NOT $1::boolean AND t.amount > 0)
      ORDER BY t.local_day`,
    [saidas],
  );

  const abrir = (valor) => {
    if (!valor) return "";
    try {
      return decifrarCom(chave, valor);
    } catch {
      return "";
    }
  };

  const achadas = [];
  for (const linha of linhas) {
    const nome = abrir(linha.counterparty_name_enc);
    const descricao = abrir(linha.description_enc);
    if (!simplificar(`${nome} ${descricao}`).includes(alvo)) continue;

    const dia = String(linha.local_day).slice(0, 10);
    if (anoPedido && Number(dia.slice(0, 4)) !== anoPedido) continue;

    achadas.push({
      dia,
      valor: Math.abs(Number(linha.amount)),
      nome: nome || descricao,
      conta: abrir(linha.conta_enc) || linha.connector_name,
    });
  }

  if (achadas.length === 0) {
    console.log(`Nada encontrado para "${busca}".`);
    console.log("O extrato so tem o que a Pluggy entregou — ela nao traz o passado inteiro.");
    process.exit(0);
  }

  const porAno = new Map();
  for (const a of achadas) {
    const ano = a.dia.slice(0, 4);
    const mes = a.dia.slice(0, 7);
    const doAno = porAno.get(ano) ?? { total: 0, contagem: 0, meses: new Map() };
    doAno.total += a.valor;
    doAno.contagem += 1;
    const doMes = doAno.meses.get(mes) ?? { total: 0, lancamentos: [] };
    doMes.total += a.valor;
    doMes.lancamentos.push(a);
    doAno.meses.set(mes, doMes);
    porAno.set(ano, doAno);
  }

  const rotulo = saidas ? "pago a" : "recebido de";
  console.log(`${achadas.length} lancamento(s) ${rotulo} "${busca}"`);
  console.log(`conta(s): ${[...new Set(achadas.map((a) => a.conta))].join(", ")}\n`);

  for (const [ano, dados] of [...porAno].sort()) {
    console.log(`━━ ${ano}   ${dinheiro(dados.total)}   em ${dados.contagem} lancamento(s)`);
    for (const [mes, doMes] of [...dados.meses].sort()) {
      const parcelas = doMes.lancamentos.map((l) => dinheiro(l.valor)).join(" + ");
      console.log(`   ${mes}  ${dinheiro(doMes.total).padStart(16)}   ${parcelas}`);
    }
    console.log();
  }

  const total = achadas.reduce((s, a) => s + a.valor, 0);
  console.log(`TOTAL  ${dinheiro(total)}`);
} finally {
  await banco.fim?.();
}
