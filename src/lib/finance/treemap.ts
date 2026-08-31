/**
 * Treemap por subdivisao quadratica (squarified, Bruls et al.).
 *
 * Area proporcional ao valor, com os retangulos o mais proximos do quadrado que
 * a subdivisao permite. A forma importa: retangulo muito alongado engana a
 * comparacao de area — dois blocos de mesma area parecem diferentes se um for
 * uma tira e o outro um quadrado — e nao cabe rotulo dentro.
 *
 * Modulo puro, em coordenadas abstratas: quem desenha decide a unidade.
 */

export interface ItemDeTreemap {
  id: string;
  /** Precisa ser positivo. Zero e negativo sao descartados: area nao tem sinal. */
  valor: number;
}

export interface Retangulo {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface ComArea extends ItemDeTreemap {
  area: number;
}

interface Livre {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pior razao de aspecto da fila se ela for despejada agora.
 *
 * E o criterio que decide quando fechar a fila: enquanto acrescentar o proximo
 * item melhorar (ou nao piorar) a pior razao, ele entra.
 */
function pior(fila: ComArea[], lado: number): number {
  if (fila.length === 0) return Number.POSITIVE_INFINITY;

  const soma = fila.reduce((total, item) => total + item.area, 0);
  if (soma <= 0 || lado <= 0) return Number.POSITIVE_INFINITY;

  const maior = Math.max(...fila.map((item) => item.area));
  const menor = Math.min(...fila.map((item) => item.area));
  if (menor <= 0) return Number.POSITIVE_INFINITY;

  const lado2 = lado * lado;
  const soma2 = soma * soma;
  return Math.max((lado2 * maior) / soma2, soma2 / (lado2 * menor));
}

/** Escreve a fila na borda mais curta e devolve o espaco que sobrou. */
function despejar(fila: ComArea[], livre: Livre, saida: Retangulo[]): Livre {
  const soma = fila.reduce((total, item) => total + item.area, 0);
  if (soma <= 0) return livre;

  const { x, y, w, h } = livre;

  // Coluna quando o espaco livre e mais largo que alto; linha no caso contrario.
  if (w >= h) {
    const largura = soma / h;
    let cursor = y;
    for (const item of fila) {
      const altura = item.area / largura;
      saida.push({ id: item.id, x, y: cursor, w: largura, h: altura });
      cursor += altura;
    }
    return { x: x + largura, y, w: w - largura, h };
  }

  const altura = soma / w;
  let cursor = x;
  for (const item of fila) {
    const largura = item.area / altura;
    saida.push({ id: item.id, x: cursor, y, w: largura, h: altura });
    cursor += largura;
  }
  return { x, y: y + altura, w, h: h - altura };
}

/**
 * Distribui os itens na caixa, do maior para o menor.
 *
 * A soma das areas devolvidas e exatamente a area da caixa, entao a leitura
 * "quanto deste retangulo e aquele bloco" vale como fracao do todo.
 */
export function squarify(
  itens: ItemDeTreemap[],
  largura: number,
  altura: number,
): Retangulo[] {
  if (largura <= 0 || altura <= 0) return [];

  const validos = itens.filter((item) => item.valor > 0);
  if (validos.length === 0) return [];

  const total = validos.reduce((soma, item) => soma + item.valor, 0);
  const escala = (largura * altura) / total;

  const ordenados: ComArea[] = [...validos]
    .sort((a, b) => b.valor - a.valor || a.id.localeCompare(b.id))
    .map((item) => ({ ...item, area: item.valor * escala }));

  const saida: Retangulo[] = [];
  let livre: Livre = { x: 0, y: 0, w: largura, h: altura };
  let fila: ComArea[] = [];

  for (const item of ordenados) {
    const lado = Math.min(livre.w, livre.h);
    const candidata = [...fila, item];

    if (fila.length === 0 || pior(candidata, lado) <= pior(fila, lado)) {
      fila = candidata;
      continue;
    }

    livre = despejar(fila, livre, saida);
    fila = [item];
  }

  if (fila.length > 0) despejar(fila, livre, saida);

  return saida;
}

/** Encolhe um retangulo por dentro, para abrir respiro entre blocos vizinhos. */
export function recuar(retangulo: Retangulo, margem: number): Retangulo {
  const w = Math.max(0, retangulo.w - margem * 2);
  const h = Math.max(0, retangulo.h - margem * 2);
  return { ...retangulo, x: retangulo.x + margem, y: retangulo.y + margem, w, h };
}
