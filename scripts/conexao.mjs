#!/usr/bin/env node
/**
 * Cadastra uma conexao pelo terminal.
 *
 * Uso:
 *   node scripts/conexao.mjs https://meu.pluggy.ai/connections/<itemId>
 *   node scripts/conexao.mjs --listar
 *   node scripts/conexao.mjs --remover <itemId>
 *
 * A tela /conexoes faz o mesmo; isto existe para encadear com a sincronizacao
 * num comando so.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

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

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), {
  max: 1,
  ssl: "require",
});

try {
  const argumento = process.argv[2];

  if (!argumento || argumento === "--listar") {
    const linhas = await sql`
      SELECT c.item_id, c.connector_name, c.last_synced_at,
             (SELECT count(*) FROM accounts a
               WHERE a.item_id = c.item_id AND a.archived_at IS NULL) AS contas
        FROM connections c ORDER BY c.connector_name
    `;
    for (const l of linhas) {
      const quando = l.last_synced_at ? new Date(l.last_synced_at).toLocaleString("pt-BR") : "nunca";
      console.log(`${l.connector_name.padEnd(26)} ${l.contas} contas · ${quando} · ${l.item_id}`);
    }
    process.exit(0);
  }

  if (argumento === "--remover") {
    const alvo = (process.argv[3] ?? "").match(UUID)?.[0];
    if (!alvo) {
      console.error("informe o itemId a remover.");
      process.exit(1);
    }
    // As contas sao arquivadas pelo gatilho do banco; as transacoes ficam.
    await sql`DELETE FROM connections WHERE item_id = ${alvo}`;
    console.log(`conexao ${alvo} removida. Historico preservado.`);
    process.exit(0);
  }

  const itemId = argumento.match(UUID)?.[0]?.toLowerCase();
  if (!itemId) {
    console.error("Nao encontrei um itemId. Cole a URL da conexao no Meu Pluggy.");
    process.exit(1);
  }

  await sql`
    INSERT INTO connections (item_id, connector_name)
    VALUES (${itemId}, ${"(aguardando sincronizacao)"})
    ON CONFLICT (item_id) DO NOTHING
  `;
  console.log(`conexao ${itemId} cadastrada. Rode: npm run sync:local 365`);
} finally {
  await sql.end();
}
