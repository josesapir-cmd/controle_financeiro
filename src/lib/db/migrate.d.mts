export interface Executor {
  unsafe(query: string): Promise<unknown>;
}

export interface OpcoesDeMigracao {
  /**
   * Para no arquivo indicado, inclusive. Serve aos testes que precisam preparar
   * o banco no estado de uma versao antiga antes de exercitar a seguinte.
   */
  ate?: string;
}

/** Aplica as migracoes pendentes e devolve os nomes das aplicadas agora. */
export function migrate(
  executor: Executor,
  log?: (mensagem: string) => void,
  opcoes?: OpcoesDeMigracao,
): Promise<string[]>;
