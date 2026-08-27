#!/usr/bin/env node
/**
 * Leva para o banco o que estava em arquivos locais: os itemIds das conexoes e
 * o cadastro de contrapartes.
 *
 * Roda uma vez, na virada para a nuvem. E idempotente — repetir nao duplica.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";
import { fingerprintWith } from "../src/lib/fingerprint.mjs";
import { createCipheriv, randomBytes } from "node:crypto";

/** Mesma cifra usada pelo app: v1.<nonce>.<cifra+tag>, AES-256-GCM. */
function cifrar(chave, texto) {
  if (!texto) return null;
  const nonce = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", chave, nonce);
  const corpo = Buffer.concat([c.update(texto, "utf8"), c.final(), c.getAuthTag()]);
  return `v1.${nonce.toString("base64url")}.${corpo.toString("base64url")}`;
}

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
      // Sem arquivo de ambiente: as variaveis podem vir do proprio ambiente.
    }
  }
}

async function lerJson(arquivo) {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "data", arquivo), "utf8"));
  } catch {
    return null;
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
  // --- Conexoes ---
  const doArquivo = (await lerJson("items.json"))?.itemIds ?? [];
  const doAmbiente = (process.env.PLUGGY_ITEM_IDS ?? "").split(",").map((s) => s.trim());
  const itemIds = [...new Set([...doArquivo, ...doAmbiente])].filter(Boolean);

  for (const itemId of itemIds) {
    // O nome real da instituicao chega na primeira sincronizacao; aqui so
    // garantimos que a conexao exista para ser sincronizada.
    await sql`
      INSERT INTO connections (item_id, connector_name)
      VALUES (${itemId}, ${"(aguardando sincronizacao)"})
      ON CONFLICT (item_id) DO NOTHING
    `;
  }
  console.log(`conexoes: ${itemIds.length}`);

  // --- Cadastro de contrapartes ---
  const cadastro = (await lerJson("counterparties.json")) ?? {};
  const chaves = Object.keys(cadastro);

  if (chaves.length > 0 && !process.env.APP_ENCRYPTION_KEY) {
    console.error("APP_ENCRYPTION_KEY necessaria para importar o cadastro.");
    process.exit(1);
  }

  const chaveCripto = process.env.APP_ENCRYPTION_KEY
    ? Buffer.from(process.env.APP_ENCRYPTION_KEY, "base64")
    : null;

  for (const chave of chaves) {
    const entrada = cadastro[chave];
    const fp = fingerprintWith(chaveCripto, "counterparty", chave);

    await sql`
      INSERT INTO counterparty_labels (fingerprint, category, subcategory, alias_enc)
      VALUES (
        ${fp},
        ${entrada.category ?? null},
        ${entrada.subcategory ?? null},
        ${cifrar(chaveCripto, entrada.alias ?? null)}
      )
      ON CONFLICT (fingerprint) DO UPDATE
        SET category = EXCLUDED.category,
            subcategory = EXCLUDED.subcategory,
            alias_enc = EXCLUDED.alias_enc,
            updated_at = now()
    `;
  }
  console.log(`rotulos de contraparte: ${chaves.length}`);
  console.log("\nPronto. Rode a sincronizacao para popular contas e transacoes.");
} finally {
  await sql.end();
}
