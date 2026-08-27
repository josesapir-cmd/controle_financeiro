#!/usr/bin/env node
/**
 * Revela a forma da paginacao de GET /v2/transactions.
 *
 * Le as conexoes do banco e as credenciais do .env.local; imprime, para cada
 * conta, os campos da resposta que NAO sao a lista de resultados — que e onde
 * mora a paginacao. Nao imprime nenhuma transacao.
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
const API = "https://api.pluggy.ai";

const auth = await fetch(`${API}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  }),
});
const { apiKey } = await auth.json();

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), { max: 1, ssl: "require" });
const conexoes = await sql`SELECT item_id, connector_name FROM connections ORDER BY connector_name`;

for (const { item_id, connector_name } of conexoes) {
  console.log(`\n━━ ${connector_name} [${item_id.slice(0, 8)}…]`);

  const contas = await fetch(`${API}/accounts?itemId=${item_id}`, {
    headers: { "X-API-KEY": apiKey },
  }).then((r) => r.json());

  if (!contas.results?.length) {
    console.log(`   sem contas (total=${contas.total ?? "?"})`);
    continue;
  }

  for (const conta of contas.results) {
    const resposta = await fetch(`${API}/v2/transactions?accountId=${conta.id}`, {
      headers: { "X-API-KEY": apiKey },
    });
    const corpo = await resposta.json();

    if (!resposta.ok) {
      console.log(`   ${conta.type.padEnd(6)} HTTP ${resposta.status}: ${corpo.message}`);
      continue;
    }

    const { results, ...paginacao } = corpo;
    console.log(
      `   ${conta.type.padEnd(6)} ${String(results?.length ?? 0).padStart(3)} itens · paginacao: ${JSON.stringify(paginacao)}`,
    );
  }
}

await sql.end();
