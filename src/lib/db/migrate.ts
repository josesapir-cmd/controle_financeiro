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

export interface Executor {
  unsafe(query: string): Promise<unknown>;
}

const DIRETORIO = path.join(process.cwd(), "src", "lib", "db", "migrations");

export async function migrate(
  executor: Executor,
  log: (mensagem: string) => void = () => {},
): Promise<string[]> {
  await executor.unsafe(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    );
  `);

  const aplicadas = new Set(
    ((await executor.unsafe("SELECT name FROM schema_migrations")) as { name: string }[]).map(
      (linha) => linha.name,
    ),
  );

  const arquivos = (await readdir(DIRETORIO)).filter((nome) => nome.endsWith(".sql")).sort();
  const novas: string[] = [];

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
