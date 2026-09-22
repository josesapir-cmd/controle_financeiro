/** Uma linha do arquivo diario do Tesouro, ja em numeros. */
export interface PrecoDoTesouro {
  /** "Tesouro Renda+ Aposentadoria Extra 2065", como o Tesouro escreve. */
  titulo: string;
  /** ISO. A data que, junto com o titulo, identifica o papel. */
  vence: string;
  /** ISO. O dia a que os precos se referem. */
  base: string;
  /** A taxa da curva, sem o spread. E a que vai para a tela. */
  taxaCompra: number;
  /** A taxa de recompra: a de compra mais o spread. */
  taxaVenda: number;
  precoCompra: number;
  /** O preco pelo qual o Tesouro recompra — o que a posicao vale vendendo hoje. */
  precoVenda: number;
}

/** Onde cada coluna esta no cabecalho. */
export interface ColunasDoPrecoTaxa {
  titulo: number;
  vence: number;
  base: number;
  taxaCompra: number;
  taxaVenda: number;
  precoCompra: number;
  precoVenda: number;
}

/** O que se sabe de uma posicao na hora de procurar o titulo dela. */
export interface PosicaoParaCasar {
  /** O preco unitario que a corretora marcou — o de recompra. */
  precoUnitario: number | null;
  /** ISO, quando a corretora informa. */
  vence: string | null;
}

export function colunasDoPrecoTaxa(linha: string): ColunasDoPrecoTaxa | null;
export function lerLinhaDePrecoTaxa(
  indices: ColunasDoPrecoTaxa,
  linha: string,
): PrecoDoTesouro | null;
export function lerPrecoTaxa(texto: string): PrecoDoTesouro[];
export function doUltimoDia(precos: PrecoDoTesouro[]): PrecoDoTesouro[];
export function casarComOTitulo(
  posicao: PosicaoParaCasar,
  precos: PrecoDoTesouro[],
  tolerancia?: number,
): PrecoDoTesouro | null;
export function spreadEmBps(preco: PrecoDoTesouro): number;
