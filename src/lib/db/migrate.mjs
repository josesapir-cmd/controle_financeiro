import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Executor de migracoes.
 *
 * Arquivos .sql numerados, aplicados em ordem e registrados numa tabela de
 * controle — cada um roda uma vez so. Recebe o executor de SQL por parametro
 * para poder rodar tanto contra o Neon quanto contra o Postgres em memoria dos
 * testes.
 */

/**
 * @typedef {{ unsafe: (query: string) => Promise<unknown> }} Executor
 */

const DIRETORIO = path.join(process.cwd(), "src", "lib", "db", "migrations");

/**
 * Em JavaScript puro de proposito: e o mesmo arquivo usado pelo script de linha
 * de comando e pelos testes, e importar TypeScript de um script depende de uma
 * flag do Node que muda entre versoes.
 *
 * @param {Executor} executor
 * @param {(mensagem: string) => void} [log]
 * @returns {Promise<string[]>}
 */
export async function migrate(executor, log = () => {}) {
  await executor.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const linhas = /** @type {{ name: string }[]} */ (
    await executor.unsafe("SELECT name FROM schema_migrations")
  );
  const aplicadas = new Set(linhas.map((linha) => linha.name));

  const arquivos = (await readdir(DIRETORIO)).filter((nome) => nome.endsWith(".sql")).sort();
  /** @type {string[]} */
  const novas = [];

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;

    const conteudo = await readFile(path.join(DIRETORIO, arquivo), "utf8");
    log(`aplicando ${arquivo}`);

    // Cada migracao roda inteira ou nao roda: um arquivo aplicado pela metade
    // deixaria o esquema num estado que nenhuma execucao futura conserta.
    await executor.unsafe(`BEGIN;\n${conteudo}\nCOMMIT;`);
    await executor.unsafe(
      `INSERT INTO schema_migrations (name) VALUES ('${arquivo.replace(/'/g, "''")}')`,
    );

    novas.push(arquivo);
  }

  return novas;
}
