/**
 * Abre o banco pelo transporte que a rede permitir.
 *
 * A Neon aceita as duas coisas: Postgres direto na 5432 e a mesma coisa por
 * HTTPS na 443, com o driver serverless. A 5432 e a primeira a ser fechada em
 * wifi de hotel, escritorio e VPN corporativa — e quando ela cai, nenhum script
 * daqui roda, nem migracao, nem diagnostico. A 443 passa em todo lugar.
 *
 * Entao o padrao para host da Neon e HTTPS. Quem quiser o TCP de volta (para
 * medir latencia, ou para um banco que nao seja Neon) usa `PGTRANSPORTE=tcp`.
 *
 * A interface e uma so — `query(texto, parametros)` e `transacao(fn)` — para os
 * scripts nao saberem por onde estao falando.
 */

import postgres from "postgres";
import { normalizeConnectionString } from "../src/lib/db/connection-string.mjs";

function ehNeon(url) {
  try {
    return new URL(url).hostname.endsWith(".neon.tech");
  } catch {
    return false;
  }
}

async function porHttps(url) {
  // Importado so quando vai ser usado: quem roda contra Postgres local nao
  // precisa ter o driver da Neon instalado.
  const { Pool, neonConfig } = await import("@neondatabase/serverless");

  // Node 22 tem WebSocket nativo; antes disso o driver precisa de um.
  if (typeof WebSocket === "undefined") {
    try {
      const ws = await import("ws");
      neonConfig.webSocketConstructor = ws.default;
    } catch {
      throw new Error(
        "Este Node nao tem WebSocket e o pacote `ws` nao esta instalado.\n" +
          "Atualize para Node 22+ ou rode com PGTRANSPORTE=tcp.",
      );
    }
  }

  const pool = new Pool({ connectionString: url });

  return {
    transporte: "https",
    async query(texto, parametros = []) {
      // Sem parametros o driver usa o protocolo simples, que aceita varias
      // instrucoes num texto so — e disso que o migrador depende, porque manda
      // `BEGIN; <arquivo>; COMMIT;` de uma vez. Nesse caso a resposta vem como
      // lista de resultados, e o que interessa e o ultimo.
      const resposta = await pool.query(texto, parametros.length ? parametros : undefined);
      if (Array.isArray(resposta)) return resposta[resposta.length - 1]?.rows ?? [];
      return resposta.rows;
    },
    async transacao(executar) {
      const cliente = await pool.connect();
      try {
        await cliente.query("BEGIN");
        const resultado = await executar({
          async query(texto, parametros = []) {
            const { rows } = await cliente.query(texto, parametros);
            return rows;
          },
        });
        await cliente.query("COMMIT");
        return resultado;
      } catch (erro) {
        await cliente.query("ROLLBACK").catch(() => {});
        throw erro;
      } finally {
        cliente.release();
      }
    },
    async fim() {
      await pool.end();
    },
  };
}

function porTcp(url) {
  const sql = postgres(url, { max: 1, ssl: "require" });

  return {
    transporte: "tcp",
    sql,
    async query(texto, parametros = []) {
      return sql.unsafe(texto, parametros);
    },
    async transacao(executar) {
      return sql.begin((tx) =>
        executar({
          async query(texto, parametros = []) {
            return tx.unsafe(texto, parametros);
          },
        }),
      );
    },
    async fim() {
      await sql.end();
    },
  };
}

export async function abrirBanco(bruta = process.env.DATABASE_URL) {
  if (!bruta) {
    console.error("DATABASE_URL nao definida.");
    process.exit(1);
  }

  const url = normalizeConnectionString(bruta);
  const forcado = process.env.PGTRANSPORTE;

  if (forcado === "tcp" || (forcado !== "https" && !ehNeon(url))) return porTcp(url);
  return porHttps(url);
}
