#!/usr/bin/env node
/**
 * Aplica as migracoes pendentes no banco apontado por DATABASE_URL.
 * Uso: node scripts/migrate.mjs
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { migrate } from "../src/lib/db/migrate.mjs";
import { abrirBanco } from "./conectar.mjs";
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

const soEstado = process.argv.includes("--estado");

const banco = await abrirBanco();

// `migrate` fala `unsafe(texto)`, que e o formato do postgres.js. Por HTTPS a
// mesma coisa e `query`; a ponte cabe aqui e evita mexer no migrador.
const executor = {
  async unsafe(texto) {
    return banco.query(texto);
  },
};

try {
  if (soEstado) {
    // "Nada pendente" tem duas causas que se parecem: o banco esta em dia, ou
    // os arquivos nao estao aqui. A lista separa as duas.
    const { readdir } = await import("node:fs/promises");
    const diretorio = path.join(process.cwd(), "src", "lib", "db", "migrations");
    const arquivos = (await readdir(diretorio)).filter((n) => n.endsWith(".sql")).sort();

    await banco.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const linhas = await banco.query("SELECT name, applied_at FROM schema_migrations");
    const aplicadas = new Map(linhas.map((l) => [l.name, l.applied_at]));

    console.log(`arquivos em src/lib/db/migrations: ${arquivos.length}`);
    console.log(`registradas no banco: ${aplicadas.size}\n`);

    for (const arquivo of arquivos) {
      const quando = aplicadas.get(arquivo);
      console.log(
        `  ${quando ? "aplicada " : "PENDENTE "} ${arquivo}${
          quando ? `  ${new Date(quando).toLocaleString("pt-BR")}` : ""
        }`,
      );
    }

    const orfas = [...aplicadas.keys()].filter((nome) => !arquivos.includes(nome));
    if (orfas.length) {
      console.log("\n  Registradas no banco sem arquivo correspondente aqui:");
      for (const nome of orfas) console.log(`    ${nome}`);
      console.log("  Isso quer dizer que este clone esta atras do banco — falta um git pull.");
    }

    process.exit(0);
  }

  const novas = await migrate(executor, (m) => console.log(m));
  console.log(novas.length ? `${novas.length} migracao(oes) aplicada(s).` : "Nada pendente.");
} catch (erro) {
  morrerComExplicacao(erro);
} finally {
  await banco.fim();
}
