#!/usr/bin/env node
/**
 * De onde sai (ou nao sai) o nome da contraparte num Pix.
 *
 * O app so mostra "PIX para Fulano" quando sabe quem e Fulano, e hoje ele so
 * pergunta isso a um lugar: `paymentData.receiver.name`. Quando o cartao
 * aparece como "Transferencia enviada pelo Pix", sem nome nenhum, e porque esse
 * campo veio vazio — e a pergunta passa a ser se o nome existe em outro campo
 * da resposta da Pluggy.
 *
 * Este script pega os Pix recentes de cada conta e imprime, lado a lado, TODOS
 * os campos onde um nome poderia estar. E de leitura: nao grava nada.
 *
 * Uso:
 *   node scripts/inspecionar-pix.mjs          # ultimos 15 dias, 8 exemplos
 *   node scripts/inspecionar-pix.mjs 45 20
 *
 * Privacidade: documentos saem mascarados (so os ultimos digitos). Nomes de
 * contraparte saem inteiros — sao justamente o que se quer descobrir — entao
 * rode isto na sua maquina e nao cole a saida inteira em lugar publico.
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

const DIAS = Number(process.argv[2] ?? 15);
const LIMITE = Number(process.argv[3] ?? 8);
const API = "https://api.pluggy.ai";

const auth = await fetch(`${API}/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    clientId: process.env.PLUGGY_CLIENT_ID,
    clientSecret: process.env.PLUGGY_CLIENT_SECRET,
  }),
});
if (!auth.ok) {
  console.error(`/auth respondeu ${auth.status}. Confira PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.`);
  process.exit(1);
}
const { apiKey } = await auth.json();

const desde = new Date(Date.now() - DIAS * 86400_000).toISOString().slice(0, 10);

function mascarar(valor) {
  const d = String(valor ?? "").replace(/\D/g, "");
  return d ? `•••${d.slice(-3)}` : null;
}

/** Um participante em uma linha, dizendo o que veio e o que veio vazio. */
function lado(rotulo, p) {
  if (!p) return `${rotulo}: ausente`;
  const partes = [
    `name=${p.name ? JSON.stringify(p.name) : "null"}`,
    `doc=${mascarar(p.documentNumber?.value) ?? "null"}`,
  ];
  const extras = Object.keys(p).filter(
    (k) => !["name", "documentNumber"].includes(k) && p[k] !== null && p[k] !== undefined,
  );
  if (extras.length) partes.push(`outros=[${extras.join(", ")}]`);
  return `${rotulo}: ${partes.join(" ")}`;
}

function ehPix(t) {
  const texto = `${t.description ?? ""} ${t.descriptionRaw ?? ""} ${t.category ?? ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return /\bpix\b/.test(texto) || t.paymentData?.paymentMethod === "PIX";
}

const sql = postgres(normalizeConnectionString(process.env.DATABASE_URL), { max: 1, ssl: "require" });
const conexoes = await sql`SELECT item_id, connector_name FROM connections ORDER BY connector_name`;

let comNome = 0;
let semNome = 0;

for (const { item_id, connector_name } of conexoes) {
  const contas = await fetch(`${API}/accounts?itemId=${item_id}`, {
    headers: { "X-API-KEY": apiKey },
  }).then((r) => r.json());

  for (const conta of contas.results ?? []) {
    const url = `${API}/v2/transactions?accountId=${conta.id}&from=${desde}&pageSize=200`;
    const resposta = await fetch(url, { headers: { "X-API-KEY": apiKey } });
    if (!resposta.ok) {
      console.log(`\n━━ ${connector_name} · ${conta.name}: HTTP ${resposta.status}`);
      continue;
    }

    const { results = [] } = await resposta.json();
    const pix = results.filter(ehPix);
    if (pix.length === 0) continue;

    console.log(`\n━━ ${connector_name} · ${conta.name} · ${pix.length} Pix em ${DIAS} dias`);

    for (const t of pix) {
      const saida = t.amount < 0 || conta.type === "CREDIT";
      const outro = saida ? t.paymentData?.receiver : t.paymentData?.payer;
      if (outro?.name) comNome += 1;
      else semNome += 1;
    }

    for (const t of pix.slice(0, LIMITE)) {
      console.log(`\n  ${t.date?.slice(0, 16)}  ${t.amount}`);
      console.log(`    description    : ${JSON.stringify(t.description)}`);
      console.log(`    descriptionRaw : ${JSON.stringify(t.descriptionRaw ?? null)}`);
      console.log(`    category       : ${JSON.stringify(t.category ?? null)}`);
      console.log(`    type           : ${JSON.stringify(t.type ?? null)}`);
      if (t.merchant) console.log(`    merchant       : ${JSON.stringify(t.merchant)}`);
      if (!t.paymentData) {
        console.log("    paymentData    : AUSENTE");
        continue;
      }
      console.log(`    paymentMethod  : ${JSON.stringify(t.paymentData.paymentMethod ?? null)}`);
      console.log(`    ${lado("payer   ", t.paymentData.payer)}`);
      console.log(`    ${lado("receiver", t.paymentData.receiver)}`);
      const sobra = Object.keys(t.paymentData).filter(
        (k) => !["payer", "receiver", "paymentMethod"].includes(k),
      );
      if (sobra.length) {
        console.log(`    outros campos  : ${JSON.stringify(Object.fromEntries(sobra.map((k) => [k, t.paymentData[k]])))}`);
      }
    }
  }
}

console.log(`\n=== RESUMO ===`);
console.log(`  Pix com nome da contraparte : ${comNome}`);
console.log(`  Pix sem nome da contraparte : ${semNome}`);
if (semNome > 0) {
  console.log(`\n  Para os sem nome, olhe acima se o nome aparece em descriptionRaw`);
  console.log(`  ou em algum campo que o app ainda nao le.`);
}

await sql.end();
