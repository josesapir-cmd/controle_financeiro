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

/**
 * Adapta o cliente postgres.js, cujo `unsafe` aceita SQL com parametros.
 *
 * A assinatura de `unsafe` na biblioteca e generica demais para casar com a
 * nossa sem conversao; o cast fica confinado aqui, num lugar so, em vez de
 * espalhar `any` pelo repositorio.
 */
type PostgresLike = {
  unsafe: (text: string, params?: never[]) => Promise<unknown>;
};

export function fromPostgres(sql: unknown): Db {
  const cliente = sql as PostgresLike;
  return {
    async query<T>(text: string, params: unknown[] = []) {
      return (await cliente.unsafe(text, params as never[])) as T[];
    },
  };
}
