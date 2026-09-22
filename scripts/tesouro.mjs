#!/usr/bin/env node
/**
 * O preco oficial do Tesouro Direto, baixado.
 *
 * A conciliacao com o site mostrou o problema: quatro custodias marcam o MESMO
 * titulo a precos diferentes. Inter a 186,95, Nubank a 188,48, BTG e XP a
 * 189,12 — e so o Inter batia com o Tesouro. A Renda+ aparecia R$ 54 mil mais
 * cara do que e.
 *
 * Nao e erro de metodologia: 1,16% de preco num papel de quarenta e tres anos
 * de duration sao 2,7 pontos-base, ou seja, poucos dias de mercado. Cada
 * corretora atualiza quando quer, e isso nao tem conserto do lado delas.
 *
 * Para o Tesouro Direto existe UM preco oficial por dia, publicado no Tesouro
 * Transparente. Este script baixa, guarda a foto do dia mais recente, e a
 * carteira passa a valer quantidade x PU oficial.
 *
 * A URL do arquivo vem da API do CKAN, e nao daqui: o caminho carrega um UUID
 * que ja mudou antes. Chumbar o UUID seria trocar um dado que envelhece por
 * outro.
 *
 * Uso:
 *   node scripts/tesouro.mjs              baixa e grava a foto de hoje
 *   node scripts/tesouro.mjs --so-ver     mostra o que casaria, sem gravar
 *   node scripts/tesouro.mjs --arquivo caminho.csv   le um CSV ja baixado
 */

import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { Readable } from "node:stream";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
import {
  casarComOTitulo,
  colunasDoPrecoTaxa,
  lerLinhaDePrecoTaxa,
  spreadEmBps,
} from "../src/lib/tesouro.mjs";

const CKAN =
  "https://www.tesourotransparente.gov.br/ckan/api/3/action/package_show" +
  "?id=taxas-dos-titulos-ofertados-pelo-tesouro-direto";

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

const dinheiro = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O CSV do catalogo, sem chumbar o UUID que ja mudou antes. */
async function acharOArquivo() {
  const resposta = await fetch(CKAN);
  if (!resposta.ok) {
    throw new Error(
      `O catalogo respondeu HTTP ${resposta.status}. ` +
        "Se ele mudou de endereco, baixe o CSV a mao e use --arquivo.",
    );
  }

  const { result } = await resposta.json();
  const csv = (result?.resources ?? []).find(
    (r) => String(r.format ?? "").toUpperCase() === "CSV",
  );

  if (!csv?.url) throw new Error("O catalogo nao lista nenhum recurso CSV.");
  return csv.url;
}

/**
 * Le linha a linha e guarda so o dia mais recente.
 *
 * O arquivo tem a serie inteira desde 2002 — dezenas de megabytes. Carregar
 * tudo e filtrar depois funcionaria e gastaria memoria a toa; e a ordenacao
 * nao e garantida por nada, entao tambem nao da para ler so o fim.
 */
async function lerEmStreaming(fluxo) {
  const linhas = createInterface({ input: fluxo, crlfDelay: Infinity });

  let indices = null;
  let maisRecente = "";
  let doDia = [];
  let lidas = 0;

  for await (const linha of linhas) {
    if (!indices) {
      indices = colunasDoPrecoTaxa(linha);
      // A primeira linha util e o cabecalho; ate achar, segue procurando.
      continue;
    }

    const preco = lerLinhaDePrecoTaxa(indices, linha);
    if (!preco) continue;
    lidas += 1;

    if (preco.base > maisRecente) {
      maisRecente = preco.base;
      doDia = [preco];
    } else if (preco.base === maisRecente) {
      doDia.push(preco);
    }
  }

  if (!indices) {
    throw new Error(
      "Nao achei o cabecalho esperado no arquivo. O formato pode ter mudado.",
    );
  }

  return { doDia, maisRecente, lidas };
}

await lerEnv();

const argumentos = process.argv.slice(2);
const opcao = (nome) => {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? null : (argumentos[i + 1] ?? null);
};

const chave = lerChaveDoAmbiente();
const banco = await abrirBanco().catch(morrerComExplicacao);

const abrir = (v) => {
  if (!v) return null;
  try {
    return decifrarCom(chave, v);
  } catch {
    return null;
  }
};

try {
  const local = opcao("arquivo");
  let fluxo;

  if (local) {
    console.log(`Lendo ${local}`);
    fluxo = createReadStream(path.resolve(local), "utf8");
  } else {
    const url = await acharOArquivo();
    console.log(`Baixando ${url}`);
    const resposta = await fetch(url);
    if (!resposta.ok) {
      console.error(`O arquivo respondeu HTTP ${resposta.status}.`);
      process.exit(1);
    }
    fluxo = Readable.fromWeb(resposta.body);
  }

  const { doDia, maisRecente, lidas } = await lerEmStreaming(fluxo);

  if (doDia.length === 0) {
    console.error("O arquivo nao trouxe nenhuma linha legivel.");
    process.exit(1);
  }

  console.log(
    `\n${lidas.toLocaleString("pt-BR")} linha(s) no historico; ` +
      `${doDia.length} titulo(s) na foto de ${maisRecente}.\n`,
  );

  // Casar com o que esta na carteira: nao ha razao para guardar os 40 titulos
  // ofertados quando so alguns sao meus.
  const posicoes = await banco.query(
    `SELECT institution, name_enc, quantity, unit_price, gross_amount, balance,
            due_date
       FROM investments
      WHERE unit_price IS NOT NULL AND quantity IS NOT NULL`,
  );

  const dia = (v) =>
    !v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

  const casados = new Map();
  let semCasar = 0;

  for (const p of posicoes) {
    const achado = casarComOTitulo(
      { precoUnitario: Number(p.unit_price), vence: dia(p.due_date) },
      doDia,
    );

    const nome = abrir(p.name_enc) ?? "(sem nome)";
    if (!achado) {
      semCasar += 1;
      continue;
    }

    const qtd = Number(p.quantity);
    const antes = Number(p.gross_amount ?? p.balance ?? 0);
    const depois = qtd * achado.precoVenda;

    const g = casados.get(achado.titulo) ?? {
      preco: achado,
      qtd: 0,
      antes: 0,
      depois: 0,
      custodias: new Set(),
      nomes: new Set(),
    };
    g.qtd += qtd;
    g.antes += antes;
    g.depois += depois;
    g.custodias.add(p.institution);
    g.nomes.add(nome);
    casados.set(achado.titulo, g);
  }

  if (casados.size === 0) {
    console.log("Nenhuma posicao casou com um titulo do arquivo.");
    console.log(
      "Se voce tem Tesouro Direto na carteira, pode ser preco muito defasado\n" +
        "na corretora. Rode `npm run carteira -- --precos` para ver os PUs.",
    );
    process.exit(0);
  }

  for (const [titulo, g] of casados) {
    const diferenca = g.depois - g.antes;
    console.log(`  ${titulo}`);
    console.log(
      `    taxa de compra ${g.preco.taxaCompra.toFixed(2)}%   ` +
        `de venda ${g.preco.taxaVenda.toFixed(2)}%   ` +
        `spread ${spreadEmBps(g.preco)} bps`,
    );
    console.log(
      `    PU oficial ${g.preco.precoVenda.toFixed(2)}   ` +
        `${g.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} titulos`,
    );
    console.log(
      `    corretoras ${dinheiro(g.antes)}  ->  oficial ${dinheiro(g.depois)}` +
        `   ${diferenca >= 0 ? "+" : ""}${dinheiro(diferenca)}`,
    );
    console.log(`    custodias: ${[...g.custodias].join(", ")}`);
    console.log();
  }

  if (semCasar > 0) {
    console.log(
      `  ${semCasar} posicao(oes) com preco unitario nao casaram com nenhum titulo` +
        ` — sao os papeis que nao sao Tesouro Direto.\n`,
    );
  }

  if (argumentos.includes("--so-ver")) {
    console.log("--so-ver: nada foi gravado.");
    process.exit(0);
  }

  // So os titulos que existem na carteira. Guardar os outros seria encher a
  // tabela com preco que ninguem vai ler.
  for (const [, g] of casados) {
    await banco.query(
      `INSERT INTO treasury_quotes
         (fingerprint, title, maturity, quoted_at, buy_rate, sell_rate,
          buy_price, sell_price)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (fingerprint) DO UPDATE
         SET title = EXCLUDED.title,
             quoted_at = EXCLUDED.quoted_at,
             buy_rate = EXCLUDED.buy_rate,
             sell_rate = EXCLUDED.sell_rate,
             buy_price = EXCLUDED.buy_price,
             sell_price = EXCLUDED.sell_price,
             updated_at = now()`,
      [
        // O mesmo fingerprint que `treasuryFingerprint` no repositorio.
        (await import("../src/lib/fingerprint.mjs")).fingerprintWith(
          chave,
          "tesouro",
          `${g.preco.titulo.trim().toUpperCase()}|${g.preco.vence}`,
        ),
        g.preco.titulo.trim(),
        g.preco.vence,
        g.preco.base,
        g.preco.taxaCompra,
        g.preco.taxaVenda,
        g.preco.precoCompra,
        g.preco.precoVenda,
      ],
    );
  }

  console.log(`${casados.size} titulo(s) gravado(s) com a foto de ${maisRecente}.`);
  console.log("A carteira ja passa a marcar por estes precos.");
} finally {
  await banco.fim?.();
}
