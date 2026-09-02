#!/usr/bin/env node
/**
 * Descobre por que o banco nao responde.
 *
 * Tenta os dois transportes e diz o que cada um respondeu. E isso que separa as
 * tres causas que se parecem entre si:
 *
 * - HTTPS responde e TCP nao: o banco esta de pe e a porta 5432 esta bloqueada
 *   na sua rede. Nada a fazer no banco; os scripts ja usam HTTPS sozinhos.
 * - nenhum dos dois responde: o endpoint nao existe mais, ou a DATABASE_URL
 *   esta velha.
 * - os dois respondem: nao era conexao. O erro estava em outro lugar.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";

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

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL nao definida no .env.local.");
  process.exit(1);
}

const anfitriao = (() => {
  try {
    return new URL(process.env.DATABASE_URL).hostname;
  } catch {
    return "(URL invalida)";
  }
})();

console.log(`banco: ${anfitriao}\n`);

async function tentar(transporte) {
  const inicio = Date.now();
  process.env.PGTRANSPORTE = transporte;

  let banco;
  try {
    banco = await abrirBanco();
    const [linha] = await banco.query("SELECT count(*)::int AS tabelas FROM information_schema.tables WHERE table_schema = 'public'");
    console.log(`  ${transporte.padEnd(5)} OK em ${Date.now() - inicio}ms · ${linha.tabelas} tabelas`);
    return true;
  } catch (erro) {
    console.log(`  ${transporte.padEnd(5)} falhou em ${Date.now() - inicio}ms · ${erro.code ?? erro.message}`);
    return false;
  } finally {
    await banco?.fim().catch(() => {});
  }
}

const https = await tentar("https");
const tcp = await tentar("tcp");

console.log("");
if (https && !tcp) {
  console.log("O banco esta de pe. A porta 5432 esta bloqueada na sua rede.");
  console.log("Nada a fazer: os scripts ja usam HTTPS sozinhos quando o host e da Neon.");
} else if (!https && !tcp) {
  console.log("Nenhum dos dois respondeu. O endpoint pode nao existir mais, ou a");
  console.log("DATABASE_URL do .env.local esta desatualizada — confira no painel da Neon.");
} else if (https && tcp) {
  console.log("Os dois caminhos funcionam. O erro que voce viu nao era de conexao.");
} else {
  console.log("So o TCP funciona. Rode os scripts com PGTRANSPORTE=tcp.");
}

process.exit(https || tcp ? 0 : 1);
