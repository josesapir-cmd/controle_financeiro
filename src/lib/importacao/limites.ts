/**
 * Limites do envio de prints, compartilhados entre a tela e a rota.
 *
 * Em modulo proprio porque o componente de envio roda no cliente e nao pode
 * importar `prints.ts`, que e server-only e carrega o SDK do modelo. Duplicar
 * os numeros nos dois lados seria pedir que divergissem.
 */

/**
 * Quantas imagens vao em cada chamada ao modelo.
 *
 * Nao ha teto para quantas o usuario seleciona: a tela enfileira e envia em
 * blocos deste tamanho, um apos o outro. O bloco existe por duas razoes:
 *
 * - uma chamada com dezenas de imagens demora mais do que o limite de tempo da
 *   funcao, e uma falha no fim perderia tudo que ja tinha sido lido;
 * - dentro de um bloco o modelo enxerga as telas juntas e nao repete a linha
 *   que aparece em duas que se sobrepoem. Como prints de rolagem costumam ser
 *   consecutivos, manter vizinhos no mesmo bloco resolve a maior parte das
 *   sobreposicoes sem depender da deteccao posterior.
 */
export const TAMANHO_DO_ENVIO = 4;

export const TAMANHO_MAXIMO_BYTES = 8 * 1024 * 1024;

const TIPOS_ACEITOS = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export const ACCEPT = [...TIPOS_ACEITOS].join(",");

export function tipoAceito(tipo: string): boolean {
  return TIPOS_ACEITOS.has(tipo);
}

/** Quebra a selecao em blocos de envio, preservando a ordem escolhida. */
export function emBlocos<T>(itens: T[], tamanho = TAMANHO_DO_ENVIO): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}
