#!/usr/bin/env node
/**
 * Os ativos que o Open Finance nao ve.
 *
 * Cota de fundo fechado, cripto em carteira propria, imovel, participacao em
 * empresa: existem no patrimonio e nao existem em API nenhuma. Sem eles a soma
 * da carteira nao fica neutra — fica errada para baixo, com cara de completa.
 *
 * Nao ha tela para isso ainda. Este script e o cadastro, e serve tambem como
 * definicao do que a tela vai precisar pedir quando existir.
 *
 * Uso:
 *   node scripts/ativo.mjs                              lista os ativos
 *   node scripts/ativo.mjs --nome "Fade to Space" \
 *        --tipo CRYPTO --valor 300000 --em 2026-09-16 \
 *        --nota "valor a conferir"
 *   node scripts/ativo.mjs --id <uuid> --valor 312500 --em 2026-10-01
 *   node scripts/ativo.mjs --id <uuid> --arquivar
 *
 * Campos: --nome --tipo --subtipo --custodia --valor --aportado --lucro
 *         --taxa --vence --em --nota
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { cifrarCom, decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";

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

const argumentos = process.argv.slice(2);

function opcao(nome) {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? null : (argumentos[i + 1] ?? null);
}

/** Aceita "300000", "300.000,00" e "300000.00" — ninguem digita do mesmo jeito. */
function numero(texto) {
  if (texto === null) return null;
  const limpo = texto.replace(/[R$\s]/g, "");
  // Virgula decimal so quando ela e o ultimo separador: "1.234,56" tem ponto de
  // milhar, "1234.56" nao.
  const normalizado = limpo.lastIndexOf(",") > limpo.lastIndexOf(".")
    ? limpo.replace(/\./g, "").replace(",", ".")
    : limpo.replace(/,/g, "");
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

const dinheiro = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const HOJE = new Date().toISOString().slice(0, 10);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

await lerEnv();

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
  const id = opcao("id");

  if (id && argumentos.includes("--arquivar")) {
    await banco.query("UPDATE manual_investments SET archived_at = now() WHERE id = $1", [id]);
    console.log("arquivado. o valor historico continua no banco.");
    process.exit(0);
  }

  const nome = opcao("nome");
  const valor = numero(opcao("valor"));

  if (nome || valor !== null || id) {
    const em = opcao("em") ?? HOJE;
    if (!ISO.test(em)) {
      console.error(`--em precisa ser AAAA-MM-DD; recebi "${em}".`);
      process.exit(1);
    }

    const vence = opcao("vence");
    if (vence && !ISO.test(vence)) {
      console.error(`--vence precisa ser AAAA-MM-DD; recebi "${vence}".`);
      process.exit(1);
    }

    if (id) {
      // Edicao: so troca o que foi passado. Quem veio corrigir o valor nao
      // deveria ter que redigitar o nome e o tipo para nao perde-los.
      const [atual] = await banco.query(
        "SELECT * FROM manual_investments WHERE id = $1 AND archived_at IS NULL",
        [id],
      );

      if (!atual) {
        console.error("nao achei esse ativo (ou ele ja esta arquivado).");
        process.exit(1);
      }

      await banco.query(
        `UPDATE manual_investments
            SET name_enc = $2, institution = $3, type = $4, subtype = $5, balance = $6,
                amount = $7, profit = $8, annual_rate = $9, due_date = $10,
                valued_at = $11, note_enc = $12, updated_at = now()
          WHERE id = $1`,
        [
          id,
          nome ? cifrarCom(chave, nome) : atual.name_enc,
          opcao("custodia") ?? atual.institution,
          opcao("tipo") ?? atual.type,
          opcao("subtipo") ?? atual.subtype,
          valor ?? atual.balance,
          numero(opcao("aportado")) ?? atual.amount,
          numero(opcao("lucro")) ?? atual.profit,
          numero(opcao("taxa")) ?? atual.annual_rate,
          vence ?? atual.due_date,
          opcao("em") ?? atual.valued_at,
          opcao("nota") ? cifrarCom(chave, opcao("nota")) : atual.note_enc,
        ],
      );

      console.log("atualizado.");
    } else {
      if (!nome || valor === null) {
        console.error("para criar preciso de --nome e --valor.");
        process.exit(1);
      }

      const [criado] = await banco.query(
        `INSERT INTO manual_investments
           (name_enc, institution, type, subtype, balance, amount, profit,
            annual_rate, due_date, valued_at, note_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id`,
        [
          cifrarCom(chave, nome),
          opcao("custodia"),
          opcao("tipo") ?? "OTHER",
          opcao("subtipo"),
          valor,
          numero(opcao("aportado")),
          numero(opcao("lucro")),
          numero(opcao("taxa")),
          vence,
          em,
          opcao("nota") ? cifrarCom(chave, opcao("nota")) : null,
        ],
      );

      console.log(`criado: ${criado.id}`);
    }
  }

  const linhas = await banco.query(
    `SELECT id, name_enc, institution, type, subtype, balance, annual_rate,
            due_date, valued_at, note_enc
       FROM manual_investments
      WHERE archived_at IS NULL
      ORDER BY balance DESC`,
  );

  if (linhas.length === 0) {
    console.log("\nnenhum ativo manual cadastrado.");
    process.exit(0);
  }

  console.log(`\n${linhas.length} ativo(s) fora do Open Finance\n`);
  let total = 0;

  for (const linha of linhas) {
    const saldo = Number(linha.balance);
    total += saldo;
    const apurado = linha.valued_at instanceof Date
      ? linha.valued_at.toISOString().slice(0, 10)
      : String(linha.valued_at).slice(0, 10);

    console.log(`  ${abrir(linha.name_enc) ?? "(sem nome)"}`);
    console.log(`    ${dinheiro(saldo).padEnd(18)} apurado em ${apurado}`);
    console.log(
      `    ${linha.type}${linha.subtype ? ` / ${linha.subtype}` : ""}` +
        `${linha.institution ? ` · ${linha.institution}` : ""}`,
    );
    const nota = abrir(linha.note_enc);
    if (nota) console.log(`    ${nota}`);
    console.log(`    id ${linha.id}`);
    console.log();
  }

  console.log(`TOTAL  ${dinheiro(total)}`);
} finally {
  await banco.fim?.();
}
