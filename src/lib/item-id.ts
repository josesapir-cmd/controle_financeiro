/**
 * Leitura do itemId de uma conexao.
 *
 * Aceita tanto o UUID puro quanto a URL da conexao no Meu Pluggy
 * (meu.pluggy.ai/connections/<itemId>), que e o que o usuario tem a mao ao
 * copiar da barra de enderecos.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_EM_QUALQUER_LUGAR =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function isValidItemId(value: string): boolean {
  return UUID.test(value.trim());
}

/** Devolve null se nao houver UUID no texto. */
export function parseItemId(input: string): string | null {
  const match = input.trim().match(UUID_EM_QUALQUER_LUGAR);
  return match ? match[0].toLowerCase() : null;
}
