/**
 * A bussola do modo jogo: oito direcoes tiradas de quatro setas.
 *
 * Vive fora do componente porque e a parte que decide QUAL categoria recebe a
 * despesa. Errar aqui nao desalinha um pixel: manda o gasto para a categoria
 * errada. Fora do React, da para testar.
 */

export type Direcao = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/**
 * Ordem em que as categorias ocupam as direcoes.
 *
 * Reta antes de diagonal, de proposito: as quatro primeiras — que sao as mais
 * usadas — custam UMA tecla, e so as outras quatro custam duas. Preencher na
 * ordem da tela, do canto superior esquerdo em diante, daria as teclas baratas
 * a quem calhasse de estar no topo.
 */
export const PREENCHIMENTO: Direcao[] = ["N", "E", "S", "W", "NE", "SE", "SW", "NW"];

/** Quantas categorias cabem numa volta. O resto vai para a proxima. */
export const POR_VOLTA = PREENCHIMENTO.length;

export const SETA: Record<Direcao, string> = {
  N: "↑",
  NE: "↑→",
  E: "→",
  SE: "↓→",
  S: "↓",
  SW: "↓←",
  W: "←",
  NW: "↑←",
};

/**
 * Direcao apontada pelas setas pressionadas agora.
 *
 * Duas setas opostas se cancelam em vez de escolherem uma: quem aperta esquerda
 * e direita ao mesmo tempo nao esta apontando para lugar nenhum, e chutar um
 * lado classificaria a despesa num lugar que ninguem pediu.
 */
export function direcaoDasTeclas(teclas: ReadonlySet<string>): Direcao | null {
  const vertical = (teclas.has("ArrowUp") ? 1 : 0) - (teclas.has("ArrowDown") ? 1 : 0);
  const horizontal = (teclas.has("ArrowRight") ? 1 : 0) - (teclas.has("ArrowLeft") ? 1 : 0);

  if (vertical === 0 && horizontal === 0) return null;
  if (vertical > 0) return horizontal > 0 ? "NE" : horizontal < 0 ? "NW" : "N";
  if (vertical < 0) return horizontal > 0 ? "SE" : horizontal < 0 ? "SW" : "S";
  return horizontal > 0 ? "E" : "W";
}
