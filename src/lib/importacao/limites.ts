/**
 * Limites do envio de prints, compartilhados entre a tela e a rota.
 *
 * Em modulo proprio porque o componente de envio roda no cliente e nao pode
 * importar `prints.ts`, que e server-only e carrega o SDK do modelo. Duplicar
 * os numeros nos dois lados seria pedir que divergissem.
 */

/** Uma leitura por vez e curta; mais do que isso estoura o tempo da funcao. */
export const MAXIMO_DE_IMAGENS = 6;

export const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

const TIPOS_ACEITOS = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const ACCEPT = [...TIPOS_ACEITOS].join(",");

export function tipoAceito(tipo: string): boolean {
  return TIPOS_ACEITOS.has(tipo);
}
