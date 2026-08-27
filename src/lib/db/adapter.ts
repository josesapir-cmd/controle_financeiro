/**
 * Interface minima de banco usada pelo repositorio.
 *
 * Existe para que o mesmo codigo rode contra o Neon em producao e contra o
 * Postgres em memoria dos testes. Sem ela, o repositorio ficaria preso as
 * template tags do postgres.js e so poderia ser testado com um banco remoto —
 * ou seja, na pratica, nao seria testado.
 */
export interface Db {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

/** Adapta o cliente postgres.js, cujo `unsafe` aceita SQL com parametros. */
export function fromPostgres(sql: {
  unsafe: (text: string, params?: unknown[]) => Promise<unknown>;
}): Db {
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await sql.unsafe(text, params)) as T[];
    },
  };
}
