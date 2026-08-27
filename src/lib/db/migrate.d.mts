export interface Executor {
  unsafe(query: string): Promise<unknown>;
}

/** Aplica as migracoes pendentes e devolve os nomes das aplicadas agora. */
export function migrate(
  executor: Executor,
  log?: (mensagem: string) => void,
): Promise<string[]>;
