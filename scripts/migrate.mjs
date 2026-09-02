#!/usr/bin/env node
/**
 * Aplica as migracoes pendentes no banco apontado por DATABASE_URL.
 * Uso: node scripts/migrate.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";
import { migrate } from "../src/lib/db/migrate.mjs";
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
    } catch {
      // Arquivo ausente e normal em producao, onde as variaveis vem do ambiente.
    }
  }
}

await lerEnv();

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL nao definida.");
  process.exit(1);
}

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), {
  max: 1,
  ssl: "require",
});

try {
  const novas = await migrate(sql, (m) => console.log(m));
  console.log(novas.length ? `${novas.length} migracao(oes) aplicada(s).` : "Nada pendente.");
} catch (erro) {
  morrerComExplicacao(erro);
} finally {
  await sql.end();
}
