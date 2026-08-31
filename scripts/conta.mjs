#!/usr/bin/env node
/**
 * Resumo de uma conta: o que ha nela, por categoria e por mes.
 *
 * Serve para responder "esse tipo de gasto chega pelo Open Finance?" sem
 * precisar abrir o extrato inteiro.
 *
 * Uso:
 *   node scripts/conta.mjs                 # lista as contas
 *   node scripts/conta.mjs <id-da-conta>   # resumo de uma
 */

import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";

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

const CHAVE = Buffer.from(process.env.APP_ENCRYPTION_KEY ?? "", "base64");

function decifrar(guardado) {
  if (!guardado || CHAVE.length !== 32) return null;
  const [versao, nonce, corpo] = guardado.split(".");
  if (versao !== "v1") return null;
  const bytes = Buffer.from(corpo, "base64url");
  const d = createDecipheriv("aes-256-gcm", CHAVE, Buffer.from(nonce, "base64url"));
  d.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([d.update(bytes.subarray(0, bytes.length - 16)), d.final()]).toString("utf8");
}

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), {
  max: 1,
  ssl: "require",
});

const dinheiro = (v) =>
  Number(v).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

try {
  const alvo = process.argv[2];

  if (!alvo) {
    const contas = await sql`
      SELECT a.id, a.connector_name, a.type, a.subtype, a.name_enc, a.number_enc,
             (SELECT count(*) FROM transactions t WHERE t.account_id = a.id)::int AS total
        FROM accounts a WHERE a.archived_at IS NULL
       ORDER BY a.connector_name, a.type
    `;
    for (const c of contas) {
      const nome = decifrar(c.name_enc) ?? "?";
      const numero = decifrar(c.number_enc) ?? "";
      console.log(`${c.id}  ${c.connector_name.padEnd(14)} ${c.type.padEnd(7)} ${String(c.total).padStart(5)}  ${nome} ${numero}`);
    }
    console.log("\nDetalhe de uma conta: node scripts/conta.mjs <id>");
    process.exit(0);
  }

  /**
   * Aceita o id, o numero da conta ou parte do nome.
   *
   * O numero e o nome estao cifrados, entao a busca acontece em memoria — o que
   * e viavel porque sao poucas contas, e evita obrigar o usuario a copiar um
   * UUID quando o que ele tem a mao e o numero da conta.
   */
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const todas = await sql`
    SELECT id, connector_name, type, subtype, name_enc, number_enc, balance
      FROM accounts
  `;

  const procurado = alvo.trim().toLowerCase();
  const candidatas = UUID.test(procurado)
    ? todas.filter((c) => c.id === procurado)
    : todas.filter((c) => {
        const numero = (decifrar(c.number_enc) ?? "").toLowerCase();
        const nome = (decifrar(c.name_enc) ?? "").toLowerCase();
        // Compara tambem so os digitos: "25548893-7" e "255488937" sao o mesmo.
        const digitos = numero.replace(/\D/g, "");
        const procuradoDigitos = procurado.replace(/\D/g, "");
        return (
          numero === procurado ||
          (procuradoDigitos.length > 3 && digitos === procuradoDigitos) ||
          nome.includes(procurado)
        );
      });

  if (candidatas.length === 0) {
    console.error(`Nenhuma conta corresponde a "${alvo}".`);
    console.error("Rode sem argumento para ver a lista.");
    process.exit(1);
  }

  if (candidatas.length > 1) {
    console.error(`"${alvo}" corresponde a mais de uma conta:`);
    for (const c of candidatas) {
      console.error(`  ${c.id}  ${c.connector_name} ${decifrar(c.name_enc)} ${decifrar(c.number_enc) ?? ""}`);
    }
    console.error("Use o id.");
    process.exit(1);
  }

  const conta = candidatas[0];
  const alvoId = conta.id;

  console.log(`${conta.connector_name} · ${decifrar(conta.name_enc)} ${decifrar(conta.number_enc) ?? ""}`);
  console.log(`${conta.type}/${conta.subtype} · saldo ${dinheiro(conta.balance)}\n`);

  console.log("=== POR MES ===");
  const meses = await sql`
    SELECT to_char(local_day, 'YYYY-MM') AS mes, count(*)::int AS total,
           sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS saidas,
           sum(CASE WHEN amount > 0 THEN amount ELSE 0 END) AS entradas
      FROM transactions WHERE account_id = ${alvoId}
     GROUP BY 1 ORDER BY 1
  `;
  for (const m of meses) {
    console.log(`  ${m.mes}  ${String(m.total).padStart(4)} lanc · saiu ${dinheiro(m.saidas).padStart(16)} · entrou ${dinheiro(m.entradas)}`);
  }

  console.log("\n=== POR CATEGORIA ===");
  const categorias = await sql`
    SELECT coalesce(category, 'sem categoria') AS categoria, count(*)::int AS total,
           sum(CASE WHEN amount < 0 THEN -amount ELSE 0 END) AS saidas
      FROM transactions WHERE account_id = ${alvoId}
     GROUP BY 1 ORDER BY 3 DESC NULLS LAST LIMIT 15
  `;
  for (const c of categorias) {
    console.log(`  ${c.categoria.padEnd(30)} ${String(c.total).padStart(4)} · ${dinheiro(c.saidas)}`);
  }
} finally {
  await sql.end();
}
