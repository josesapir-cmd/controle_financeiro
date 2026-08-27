import "server-only";

import postgres from "postgres";

import { normalizeConnectionString } from "./connection-string.mjs";

/**
 * Conexao com o Postgres (Neon), criada sob demanda.
 *
 * Preguicoso de proposito: criar na importacao faria o build quebrar, porque
 * durante a compilacao o Next carrega os modulos das rotas sem ter
 * DATABASE_URL no ambiente. O erro que aparecia — "failed to collect page
 * data" — nao dizia nada sobre a causa.
 *
 * Um unico cliente por processo, reaproveitado entre requisicoes. Em ambiente
 * serverless as instancias sao recicladas com frequencia, entao o pool e
 * pequeno: dezenas de conexoes ociosas esgotariam o limite do provedor sem
 * ganho nenhum.
 */

declare global {
  // eslint-disable-next-line no-var
  var __sqlClient: ReturnType<typeof postgres> | undefined;
}

export function getSql(): ReturnType<typeof postgres> {
  if (globalThis.__sqlClient) return globalThis.__sqlClient;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL nao definida. Copie a connection string do Neon.");
  }

  const cliente = postgres(normalizeConnectionString(url), {
    max: 3,
    idle_timeout: 20,
    connect_timeout: 10,
    // Neon exige TLS. Deixar explicito evita que uma variavel mal configurada
    // faca a conexao cair para texto puro sem ninguem notar.
    ssl: "require",
    transform: { undefined: null },
  });

  globalThis.__sqlClient = cliente;
  return cliente;
}
