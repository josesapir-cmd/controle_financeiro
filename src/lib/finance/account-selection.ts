/**
 * Selecao de contas compartilhada pelas abas.
 *
 * O parametro aceita as duas formas que a interface produz: repetido
 * (`?contas=a&contas=b`, como os checkboxes enviam) e separado por virgula
 * (`?contas=a,b`, mais curto para links internos). Aceitar as duas evita que um
 * link montado a mao em uma aba se perca ao chegar na outra.
 */

export type ContasParam = string | string[] | undefined;

export function parseAccountIds(param: ContasParam): string[] {
  if (!param) return [];
  const bruto = Array.isArray(param) ? param : [param];
  const ids = bruto.flatMap((valor) => valor.split(",")).map((id) => id.trim());
  return [...new Set(ids.filter(Boolean))];
}

/** Trecho de query string para preservar a selecao ao navegar. */
export function accountQuery(accountIds: string[]): string {
  return accountIds.length ? `contas=${accountIds.map(encodeURIComponent).join(",")}` : "";
}

/** Junta trechos de query ignorando os vazios. */
export function buildQuery(...partes: (string | undefined)[]): string {
  const limpo = partes.filter((p): p is string => Boolean(p));
  return limpo.join("&");
}
