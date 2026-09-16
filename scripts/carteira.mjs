#!/usr/bin/env node
/**
 * O que esta guardado na tabela de posicoes, cru.
 *
 * Existe para uma pergunta especifica: "por que dois papeis identicos na tela
 * nao viraram uma linha so?". A tela agrupa por nome e vencimento, e nome e
 * texto cifrado — dois lotes que parecem iguais podem diferir num espaco a
 * mais, e nenhuma tela mostra isso. Aqui o nome sai entre colchetes e o
 * agrupamento e mostrado do jeito que o codigo o calcula.
 *
 * Uso:
 *   node scripts/carteira.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";

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
          process.env[chave] = limpa
            .slice(igual + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

const dinheiro = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dia = (v) =>
  !v ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

await lerEnv();

const chave = lerChaveDoAmbiente();
const banco = await abrirBanco().catch(morrerComExplicacao);

try {
  const linhas = await banco.query(
    `SELECT id, institution, type, subtype, name_enc, balance, due_date, seen_at
       FROM investments
      ORDER BY balance DESC NULLS LAST`,
  );

  if (linhas.length === 0) {
    console.log("Nenhuma posicao guardada.");
    console.log("Rode a migracao (npm run migrate) e depois uma sincronizacao em Conexoes.");
    process.exit(0);
  }

  const abrir = (v) => {
    if (!v) return null;
    try {
      return decifrarCom(chave, v);
    } catch {
      return null;
    }
  };

  const grupos = new Map();
  console.log(`${linhas.length} posicao(oes)\n`);

  for (const linha of linhas) {
    const nome = abrir(linha.name_enc) ?? "(sem nome)";
    const vence = dia(linha.due_date);
    // A mesma chave que `agruparPapeis` usa. Se duas linhas que deveriam somar
    // mostram chaves diferentes, a diferenca esta escrita aqui.
    const chaveDoGrupo = `${nome}|${vence}`;

    // Colchetes para o espaco sobrando aparecer.
    console.log(`  [${nome}]`);
    console.log(
      `     ${dinheiro(Number(linha.balance ?? 0)).padEnd(18)} ${linha.type}` +
        `${linha.subtype ? `/${linha.subtype}` : ""} · ${linha.institution}` +
        `${vence ? ` · vence ${vence}` : ""}`,
    );

    const atual = grupos.get(chaveDoGrupo) ?? { n: 0, total: 0, custodias: new Set() };
    atual.n += 1;
    atual.total += Number(linha.balance ?? 0);
    atual.custodias.add(linha.institution);
    grupos.set(chaveDoGrupo, atual);
  }

  console.log(`\n${grupos.size} linha(s) depois do agrupamento por nome e vencimento:\n`);
  for (const [chaveDoGrupo, g] of [...grupos].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${dinheiro(g.total).padStart(18)}   ${g.n} posicao(oes)` +
        `   ${g.custodias.size} custodia(s)   chave: ${chaveDoGrupo}`,
    );
  }

  if (grupos.size === linhas.length && linhas.length > 1) {
    console.log(
      "\nNenhum agrupamento aconteceu. Se dois papeis parecem iguais na tela, compare os\n" +
        "nomes entre colchetes acima: a diferenca costuma ser um espaco ou a data de vencimento.",
    );
  }
} finally {
  await banco.fim?.();
}
