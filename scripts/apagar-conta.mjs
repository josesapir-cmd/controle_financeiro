#!/usr/bin/env node
/**
 * Apaga uma conta e todo o seu historico, em definitivo.
 *
 * Existe porque "nunca apagar historico" — o padrao do app — e a regra certa
 * para as contas do proprio usuario e a errada para dado de terceiro. Quem
 * conectou a conta de outra pessoa e concluiu que ela nao serve precisa poder
 * remover o que foi guardado, nao apenas parar de atualizar.
 *
 * Uso:
 *   node scripts/apagar-conta.mjs <id|numero|nome>            # mostra o que faria
 *   node scripts/apagar-conta.mjs <id|numero|nome> --aplicar  # apaga
 */

import { createDecipheriv } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";

const APLICAR = process.argv.includes("--aplicar");
const ALVO = process.argv.slice(2).find((a) => !a.startsWith("--"));

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

if (!ALVO) {
  console.error("Informe a conta: node scripts/apagar-conta.mjs <id|numero|nome>");
  process.exit(1);
}

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

try {
  const todas = await sql`SELECT id, connector_name, name_enc, number_enc FROM accounts`;
  const procurado = ALVO.trim().toLowerCase();

  const candidatas = UUID.test(procurado)
    ? todas.filter((c) => c.id === procurado)
    : todas.filter((c) => {
        const numero = (decifrar(c.number_enc) ?? "").toLowerCase();
        const nome = (decifrar(c.name_enc) ?? "").toLowerCase();
        const digitos = numero.replace(/\D/g, "");
        const alvoDigitos = procurado.replace(/\D/g, "");
        return (
          numero === procurado ||
          (alvoDigitos.length > 3 && digitos === alvoDigitos) ||
          nome.includes(procurado)
        );
      });

  if (candidatas.length !== 1) {
    console.error(
      candidatas.length === 0
        ? `Nenhuma conta corresponde a "${ALVO}".`
        : `"${ALVO}" corresponde a ${candidatas.length} contas. Use o id.`,
    );
    for (const c of candidatas) {
      console.error(`  ${c.id}  ${c.connector_name} ${decifrar(c.name_enc)}`);
    }
    process.exit(1);
  }

  const conta = candidatas[0];
  const [{ total }] = await sql`
    SELECT count(*)::int AS total FROM transactions WHERE account_id = ${conta.id}
  `;

  console.log(`${conta.connector_name} · ${decifrar(conta.name_enc)} ${decifrar(conta.number_enc) ?? ""}`);
  console.log(`${total} lancamentos serao apagados em definitivo.\n`);

  if (!APLICAR) {
    console.log("Nada foi alterado. Repita com --aplicar para apagar.");
    process.exit(0);
  }

  // As transacoes caem junto pela chave estrangeira; apagamos explicitamente
  // para que a contagem no fim seja verificavel.
  await sql`DELETE FROM transactions WHERE account_id = ${conta.id}`;
  await sql`DELETE FROM accounts WHERE id = ${conta.id}`;

  console.log("Apagado.");
  console.log("Remova tambem a conexao correspondente, senao a proxima sincronizacao a traz de volta.");
} finally {
  await sql.end();
}
