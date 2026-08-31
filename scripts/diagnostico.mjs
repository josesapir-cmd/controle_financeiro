#!/usr/bin/env node
/**
 * Estado da sincronizacao: quando cada conexao foi atualizada pela ultima vez,
 * o que as execucoes registraram, e ate que dia ha lancamentos.
 *
 * Nao imprime nenhum dado financeiro — so contagens e datas.
 */

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

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), {
  max: 1,
  ssl: "require",
});

const agora = (d) => (d ? new Date(d).toLocaleString("pt-BR") : "nunca");

try {
  console.log("=== CONEXOES ===");
  const conexoes = await sql`
    SELECT c.connector_name, c.last_synced_at, c.last_sync_error,
           (SELECT count(*) FROM accounts a WHERE a.item_id = c.item_id AND a.archived_at IS NULL) AS contas
      FROM connections c ORDER BY c.last_synced_at NULLS FIRST
  `;
  for (const c of conexoes) {
    console.log(`  ${c.connector_name.padEnd(24)} ${c.contas} contas · ${agora(c.last_synced_at)}`);
    if (c.last_sync_error) console.log(`      ERRO: ${c.last_sync_error}`);
  }

  console.log("\n=== ULTIMAS EXECUCOES ===");
  const execucoes = await sql`
    SELECT id, started_at, finished_at, status,
           left(coalesce(detail, ''), 160) AS detalhe
      FROM sync_runs ORDER BY id DESC LIMIT 10
  `;
  if (execucoes.length === 0) console.log("  nenhuma execucao registrada");
  for (const e of execucoes) {
    const duracao = e.finished_at
      ? `${Math.round((new Date(e.finished_at) - new Date(e.started_at)) / 1000)}s`
      : "NAO TERMINOU";
    console.log(`  #${e.id} ${e.status.padEnd(8)} ${agora(e.started_at)} · ${duracao}`);
    if (e.status !== "ok" && e.detalhe) console.log(`      ${e.detalhe}`);
  }

  console.log("\n=== DADOS ===");
  const dados = await sql`
    SELECT count(*)::int AS total,
           min(local_day) AS mais_antigo,
           max(local_day) AS mais_recente,
           count(*) FILTER (WHERE first_seen_at > now() - interval '2 days')::int AS novos
      FROM transactions
  `;
  const d = dados[0];
  console.log(`  ${d.total} lancamentos · de ${d.mais_antigo} a ${d.mais_recente}`);
  console.log(`  ${d.novos} gravados nas ultimas 48h`);

  console.log("\n=== POR CONTA (ultimo lancamento) ===");
  const porConta = await sql`
    SELECT a.connector_name, a.type, max(t.local_day) AS ultimo, count(t.id)::int AS total
      FROM accounts a LEFT JOIN transactions t ON t.account_id = a.id
     WHERE a.archived_at IS NULL
     GROUP BY a.id, a.connector_name, a.type
     ORDER BY a.connector_name, a.type
  `;
  for (const c of porConta) {
    console.log(`  ${c.connector_name.padEnd(20)} ${c.type.padEnd(7)} ${String(c.total).padStart(5)} · ate ${c.ultimo ?? "—"}`);
  }
} finally {
  await sql.end();
}
