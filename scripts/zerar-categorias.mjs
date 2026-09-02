#!/usr/bin/env node
/**
 * Apaga a classificacao feita a mao, guardando antes o que sera apagado.
 *
 * Duas tabelas guardam essa classificacao, e por caminhos diferentes:
 *
 * - `transaction_labels`: a categoria daquele lancamento especifico, o que se
 *   grava arrastando um cartao ou jogando.
 * - `counterparty_labels`: a categoria da contraparte, que vale para todo
 *   lancamento dela — o "aplicar a todos".
 *
 * O que NAO e apagado, porque nao e categoria e nao foi pedido:
 *
 * - o comentario de cada lancamento (`note_enc`);
 * - o apelido e o nome oficial da contraparte (`alias_enc`, `official_name_enc`);
 * - os centros de custo, que sao taxonomia e nao atribuicao — apaga-los levaria
 *   junto "Bariloche 2026" e o orcamento dele;
 * - as decisoes de uniao de contraparte.
 *
 * A linha que fica sem nada depois da limpeza e removida; a que ainda tem
 * comentario ou apelido continua, so que sem categoria.
 *
 * Uso:
 *   node scripts/zerar-categorias.mjs                    # so mostra o que faria
 *   node scripts/zerar-categorias.mjs --aplicar          # guarda o backup e limpa
 *   node scripts/zerar-categorias.mjs --restaurar ARQUIVO
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import {
  coletarClassificacao,
  restaurarClassificacao,
  zerarClassificacao,
} from "../src/lib/db/zerar-categorias.mjs";
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

const aplicar = process.argv.includes("--aplicar");
const restaurar = process.argv[process.argv.indexOf("--restaurar") + 1];
const ehRestauracao = process.argv.includes("--restaurar");

const banco = await abrirBanco();
const db = banco;

try {
  if (ehRestauracao) {
    if (!restaurar) {
      console.error("Diga qual arquivo: --restaurar backups/categorias-....json");
      process.exit(1);
    }

    const backup = JSON.parse(await readFile(restaurar, "utf8"));
    console.log(`restaurando ${restaurar}`);
    console.log(
      `  ${backup.transacoes.length} lancamento(s), ${backup.contrapartes.length} contraparte(s)\n`,
    );

    await banco.transacao((tx) => restaurarClassificacao(tx, backup));

    console.log("restaurado.");
    process.exit(0);
  }

  const antes = await coletarClassificacao(db);

  console.log("=== O QUE SERA ZERADO ===");
  console.log(`  ${antes.transacoes.length} lancamento(s) com categoria propria`);
  console.log(`  ${antes.contrapartes.length} contraparte(s) com categoria`);

  const porCategoria = new Map();
  for (const linha of antes.contrapartes) {
    const nome = linha.category ?? "(so subcategoria)";
    porCategoria.set(nome, (porCategoria.get(nome) ?? 0) + 1);
  }
  if (porCategoria.size > 0) {
    console.log("\n  contrapartes por categoria:");
    for (const [nome, quantas] of [...porCategoria].sort((a, b) => b[1] - a[1])) {
      console.log(`    ${String(quantas).padStart(4)}  ${nome}`);
    }
  }

  console.log("\n  Nao sera tocado: comentarios, apelidos, nomes oficiais,");
  console.log("  centros de custo e decisoes de uniao de contraparte.");

  if (!aplicar) {
    console.log("\nEnsaio. Para valer: node scripts/zerar-categorias.mjs --aplicar");
    process.exit(0);
  }

  if (antes.transacoes.length === 0 && antes.contrapartes.length === 0) {
    console.log("\nNada a zerar.");
    process.exit(0);
  }

  // O backup vai para o disco ANTES de qualquer escrita: um banco limpo e um
  // arquivo que nao chegou a existir e a unica combinacao sem volta.
  const carimbo = new Date().toISOString().replace(/[:.]/g, "-");
  const destino = path.join(process.cwd(), "backups", `categorias-${carimbo}.json`);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(
    destino,
    `${JSON.stringify({ criadoEm: new Date().toISOString(), ...antes }, null, 2)}\n`,
  );
  console.log(`\nbackup em ${destino}`);

  await banco.transacao((tx) => zerarClassificacao(tx));

  const depois = await coletarClassificacao(db);
  console.log(
    `\nzerado. sobraram ${depois.transacoes.length} lancamento(s) e ${depois.contrapartes.length} contraparte(s) com categoria.`,
  );
  console.log(
    `para voltar atras: node scripts/zerar-categorias.mjs --restaurar ${path.relative(process.cwd(), destino)}`,
  );
} catch (erro) {
  morrerComExplicacao(erro);
} finally {
  await banco.fim();
}
