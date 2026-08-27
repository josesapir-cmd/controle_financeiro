import "server-only";

import postgres from "postgres";

import { normalizeConnectionString } from "./connection-string.mjs";

/**
 * Conexao com o Postgres (Neon).
 *
 * Um unico cliente por processo, reaproveitado entre requisicoes. Em ambiente
 * serverless as instancias sao recicladas com frequencia, entao o pool e
 * pequeno de proposito: abrir dezenas de conexoes ociosas esgota o limite do
 * provedor sem ganho nenhum.
 */

declare global {
  // eslint-disable-next-line no-var
  var __sqlClient: ReturnType<typeof postgres> | undefined;
}

function criar() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL nao definida. Copie a connection string do Neon.");
  }

  return postgres(normalizeConnectionString(url), {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon exige TLS. Deixar explicito evita que uma variavel de ambiente
    // mal configurada faca a conexao cair para texto puro sem ninguem notar.
    ssl: "require",
    transform: { undefined: null },
  });
}

// Em desenvolvimento o Next recarrega modulos a cada alteracao; sem o cache
// global, cada recarga abriria um pool novo e vazaria conexoes.
export const sql = globalThis.__sqlClient ?? criar();
if (process.env.NODE_ENV !== "production") globalThis.__sqlClient = sql;
