#!/usr/bin/env node
/**
 * Dispara a sincronizacao chamando a rota do app.
 *
 * Chama a rota em vez de reimplementar a logica: e exatamente o mesmo caminho
 * que o cron executa, entao o que funciona aqui funciona em producao — e nao ha
 * uma segunda copia da orquestracao para divergir.
 *
 * Uso:
 *   node scripts/sincronizar.mjs            # janela padrao (45 dias)
 *   node scripts/sincronizar.mjs 365        # carga historica de 12 meses
 *   APP_ORIGIN=https://... node scripts/sincronizar.mjs
 *
 * Exige o app rodando (npm run dev) ou APP_ORIGIN apontando para producao.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";

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
      // Sem arquivo: as variaveis podem vir do proprio ambiente.
    }
  }
}

await lerEnv();

// O fetch do Node ignora as variaveis de proxy por padrao, ao contrario do
// curl. Deixamos explicito para que uma futura mudanca de comportamento do
// Node nao passe a rotear chamadas de localhost pelo proxy do usuario.
process.env.NODE_USE_ENV_PROXY = "0";

const dias = Number(process.argv[2] ?? 45);
const origem = process.env.APP_ORIGIN || "http://localhost:3210";
const segredo = process.env.SYNC_SECRET;

if (!segredo) {
  console.error("SYNC_SECRET nao definida no .env.local.");
  process.exit(1);
}

const url = `${origem}/api/sync?dias=${dias}`;
console.log(`sincronizando ${dias} dias via ${origem} ...`);
console.log("carga historica longa pode levar varios minutos.\n");

const inicio = Date.now();

let resposta;
try {
  resposta = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${segredo}` },
    // Sem timeout curto: uma carga de 12 meses em varias conexoes demora.
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
} catch (erro) {
  console.error(`falha ao chamar ${origem}: ${erro.message}\n`);
  console.error("O servidor precisa estar de pe. Para subir e sincronizar de uma vez:\n");
  console.error("  npm run sync:local 365\n");
  process.exit(1);
}

const corpo = await resposta.json().catch(() => null);

if (!resposta.ok) {
  console.error(`HTTP ${resposta.status}:`, corpo?.error ?? "(sem detalhe)");
  process.exit(1);
}

const segundos = Math.round((Date.now() - inicio) / 1000);
console.log(`periodo: ${corpo.periodo.from} a ${corpo.periodo.to}`);
console.log(`conexoes: ${corpo.conexoes} · falhas: ${corpo.falhas} · ${segundos}s\n`);

for (const r of corpo.resultados) {
  const estado = r.error ? `ERRO — ${r.error}` : `${r.accounts} contas · ${r.transactions} lancamentos`;
  console.log(`  ${r.connectorName.padEnd(16)} ${estado}`);
}
