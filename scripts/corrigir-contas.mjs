#!/usr/bin/env node
/**
 * Une contas duplicadas e corrige as impressoes digitais.
 *
 * Necessario uma vez, por causa de um erro de projeto: a identidade da conta
 * usava o marketingName, que e campo de exibicao e muda entre sincronizacoes.
 * Ao reconectar um banco, a mesma conta ganhava identidade nova e o historico
 * era partido em duas linhas.
 *
 * O script consulta a Pluggy para saber o nome CRU de cada conta, calcula a
 * impressao digital correta, e para cada grupo de linhas que representam a
 * mesma conta (mesmo numero e subtipo) move as transacoes para uma linha so.
 *
 * E idempotente: rodar de novo nao muda nada.
 *
 * Uso: node scripts/corrigir-contas.mjs [--aplicar]
 * Sem --aplicar, apenas mostra o que faria.
 */

import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";
import { fingerprintWith } from "../src/lib/fingerprint.mjs";

const APLICAR = process.argv.includes("--aplicar");

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
if (CHAVE.length !== 32) {
  console.error("APP_ENCRYPTION_KEY ausente ou invalida.");
  process.exit(1);
}

function decifrar(guardado) {
  if (!guardado) return null;
  const [versao, nonce, corpo] = guardado.split(".");
  if (versao !== "v1") return null;

  const bytes = Buffer.from(corpo, "base64url");
  const d = createDecipheriv("aes-256-gcm", CHAVE, Buffer.from(nonce, "base64url"));
  d.setAuthTag(bytes.subarray(bytes.length - 16));
  return Buffer.concat([d.update(bytes.subarray(0, bytes.length - 16)), d.final()]).toString("utf8");
}

const API = "https://api.pluggy.ai";
const { apiKey } = await fetch(`${API}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  }),
}).then((r) => r.json());

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), {
  max: 1,
  ssl: "require",
});

try {
  // Nome cru de cada conta viva, vindo da Pluggy.
  const conexoes = await sql`SELECT item_id FROM connections`;
  const daPluggy = [];

  for (const { item_id } of conexoes) {
    const resposta = await fetch(`${API}/accounts?itemId=${item_id}`, {
      headers: { "X-API-KEY": apiKey },
    }).then((r) => r.json());

    for (const conta of resposta.results ?? []) {
      daPluggy.push({
        chave: `${conta.number ?? ""}|${conta.subtype ?? ""}`,
        fingerprint: fingerprintWith(
          CHAVE,
          "account",
          `${conta.name ?? ""}|${conta.number ?? ""}|${conta.subtype ?? ""}`,
        ),
        rotulo: `${conta.name} ${conta.number ?? ""}`.trim(),
      });
    }
  }

  // Linhas do banco agrupadas pelo que identifica a conta de verdade.
  const linhas = await sql`
    SELECT a.id, a.fingerprint, a.number_enc, a.subtype, a.connector_name, a.archived_at,
           (SELECT count(*) FROM transactions t WHERE t.account_id = a.id)::int AS transacoes
      FROM accounts a
  `;

  const grupos = new Map();
  for (const linha of linhas) {
    const chave = `${decifrar(linha.number_enc) ?? ""}|${linha.subtype ?? ""}`;
    grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
  }

  let unidas = 0;
  let rechaveadas = 0;

  for (const [chave, doGrupo] of grupos) {
    const correta = daPluggy.find((c) => c.chave === chave);

    // Mantemos a linha com mais transacoes: e a que carrega mais historico, e
    // mover menos linhas reduz a chance de erro.
    const ordenadas = [...doGrupo].sort((a, b) => b.transacoes - a.transacoes);
    const principal = ordenadas[0];
    const extras = ordenadas.slice(1);

    const rotulo = correta?.rotulo ?? `${principal.connector_name} ${chave}`;

    if (extras.length > 0) {
      console.log(`unir  ${rotulo}`);
      for (const extra of extras) {
        console.log(`        + ${extra.transacoes} lancamentos de uma linha duplicada`);
      }

      if (APLICAR) {
        for (const extra of extras) {
          await sql`UPDATE transactions SET account_id = ${principal.id} WHERE account_id = ${extra.id}`;
          await sql`DELETE FROM accounts WHERE id = ${extra.id}`;
        }
      }
      unidas += extras.length;
    }

    if (correta && principal.fingerprint !== correta.fingerprint) {
      console.log(`chave ${rotulo}: impressao digital corrigida`);
      if (APLICAR) {
        await sql`
          UPDATE accounts
             SET fingerprint = ${correta.fingerprint}, archived_at = NULL
           WHERE id = ${principal.id}
        `;
      }
      rechaveadas += 1;
    }
  }

  console.log(`\n${unidas} linha(s) duplicada(s), ${rechaveadas} impressao(oes) digital(is) a corrigir.`);
  if (!APLICAR) console.log("Nada foi alterado. Rode com --aplicar para efetivar.");
} finally {
  await sql.end();
}
