/**
 * O arquivo diario de precos e taxas do Tesouro Direto.
 *
 * Publicado no Tesouro Transparente como CSV, uma linha por titulo e por dia,
 * desde 2002. As oito colunas respondem de uma vez a pergunta que estava sendo
 * digitada a mao:
 *
 *   Taxa Compra Manha   a taxa da curva — o que rende para quem entra hoje
 *   Taxa Venda Manha    a mesma taxa mais o spread de recompra
 *   PU Compra / PU Venda   os dois precos correspondentes
 *
 * O spread deixa de ser constante chutada e passa a ser observado: e a
 * diferenca entre as duas taxas, e se o Tesouro muda, a leitura acompanha.
 *
 * `PU Venda` e o preco pelo qual o Tesouro recompra — o mesmo que a corretora
 * usa para marcar a posicao. Ele serve de chave: casar a posicao pelo preco
 * dispensa adivinhar como cada custodia escreveu o nome do papel.
 */

/** Uma linha do arquivo, ja em numeros. */
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
  precoVenda: number;
}

/** "01/03/2031" -> "2031-03-01". Fora desse formato, nulo. */
function data(bruta: string): string | null {
  const casa = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruta.trim());
  return casa ? `${casa[3]}-${casa[2]}-${casa[1]}` : null;
}

/**
 * "19851,50" -> 19851.5.
 *
 * Virgula decimal e sem separador de milhar — e como o arquivo vem. Aceitar
 * ponto tambem nao custa nada e protege de uma troca de formato silenciosa.
 */
function numero(bruto: string): number | null {
  const limpo = bruto.trim().replace(/\./g, "").replace(",", ".");
  if (!limpo) return null;
  const valor = Number(limpo);
  return Number.isFinite(valor) ? valor : null;
}

/**
 * Compara nome de coluna ignorando acento e caixa.
 *
 * O cabecalho traz "Manha" ou "Manhã" dependendo de como o arquivo foi
 * gravado, e depender disso seria deixar o parser quebrar por um til.
 */
function achatar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();
}

const COLUNAS = {
  titulo: "tipo titulo",
  vence: "data vencimento",
  base: "data base",
  taxaCompra: "taxa compra manha",
  taxaVenda: "taxa venda manha",
  precoCompra: "pu compra manha",
  precoVenda: "pu venda manha",
} as const;

/**
 * Le o CSV inteiro.
 *
 * Linha que nao converte e ignorada em silencio de proposito: o arquivo tem
 * vinte e tantos anos de historico e uma linha estragada em 2009 nao pode
 * impedir de ler a de hoje.
 */
export function lerPrecoTaxa(texto: string): PrecoDoTesouro[] {
  const linhas = texto.split(/\r?\n/);
  const cabecalho = linhas.findIndex((l) => achatar(l).startsWith(COLUNAS.titulo));
  if (cabecalho === -1) return [];

  const colunas = linhas[cabecalho].split(";").map(achatar);
  const em = (nome: string) => colunas.indexOf(nome);
  const indices = {
    titulo: em(COLUNAS.titulo),
    vence: em(COLUNAS.vence),
    base: em(COLUNAS.base),
    taxaCompra: em(COLUNAS.taxaCompra),
    taxaVenda: em(COLUNAS.taxaVenda),
    precoCompra: em(COLUNAS.precoCompra),
    precoVenda: em(COLUNAS.precoVenda),
  };

  // Sem uma das colunas essenciais o arquivo mudou de forma, e adivinhar o
  // resto produziria numeros plausiveis e errados.
  if (Object.values(indices).some((i) => i === -1)) return [];

  const lidas: PrecoDoTesouro[] = [];

  for (const linha of linhas.slice(cabecalho + 1)) {
    if (!linha.trim()) continue;
    const campos = linha.split(";");
    if (campos.length <= indices.precoVenda) continue;

    const vence = data(campos[indices.vence] ?? "");
    const base = data(campos[indices.base] ?? "");
    const taxaCompra = numero(campos[indices.taxaCompra] ?? "");
    const taxaVenda = numero(campos[indices.taxaVenda] ?? "");
    const precoCompra = numero(campos[indices.precoCompra] ?? "");
    const precoVenda = numero(campos[indices.precoVenda] ?? "");
    const titulo = (campos[indices.titulo] ?? "").trim();

    if (
      !titulo ||
      !vence ||
      !base ||
      taxaCompra === null ||
      taxaVenda === null ||
      precoCompra === null ||
      precoVenda === null
    ) {
      continue;
    }

    lidas.push({ titulo, vence, base, taxaCompra, taxaVenda, precoCompra, precoVenda });
  }

  return lidas;
}

/**
 * So o dia mais recente do arquivo.
 *
 * O CSV e a serie historica inteira; a tela quer a foto de hoje. Filtrar pela
 * maior `Data Base` e mais seguro que assumir que as ultimas linhas sao as mais
 * novas — a ordenacao do arquivo nao e garantida por nada.
 */
export function doUltimoDia(precos: PrecoDoTesouro[]): PrecoDoTesouro[] {
  if (precos.length === 0) return [];
  const ultimo = precos.reduce((maior, p) => (p.base > maior ? p.base : maior), precos[0].base);
  return precos.filter((p) => p.base === ultimo);
}

/** O que se sabe de uma posicao na hora de procurar o titulo dela. */
export interface PosicaoParaCasar {
  /** O preco unitario que a corretora marcou — o de recompra. */
  precoUnitario: number | null;
  /** ISO, quando a corretora informa. */
  vence: string | null;
}

/**
 * Acha a linha do arquivo que corresponde a posicao.
 *
 * Pelo PRECO, e nao pelo nome. A mesma NTN-B chega escrita de quatro jeitos
 * diferentes ("NTN-B1", "TESOURO DIRETO - NTN-B1", "Tesouro RendA+
 * Aposentadoria Extra 2065") e nenhuma regra de texto cobre isso sem inventar.
 * O preco de recompra e o mesmo numero nos dois lados, com seis casas.
 *
 * O vencimento entra como filtro quando existe, porque precos podem se
 * aproximar: tres Tesouro Selic de vencimentos diferentes ficam dentro de 0,3%
 * um do outro, e so o preco escolheria errado.
 *
 * Empate ainda possivel devolve nulo. Uma taxa errada na tela e pior que
 * nenhuma — foi exatamente o que esta funcao existe para nao repetir.
 */
export function casarPeloPreco(
  posicao: PosicaoParaCasar,
  precos: PrecoDoTesouro[],
  tolerancia = 0.001,
): PrecoDoTesouro | null {
  if (posicao.precoUnitario === null || posicao.precoUnitario <= 0) return null;

  const candidatos = posicao.vence
    ? precos.filter((p) => p.vence === posicao.vence)
    : precos;

  const perto = (candidatos.length > 0 ? candidatos : precos).filter(
    (p) =>
      p.precoVenda > 0 &&
      Math.abs(p.precoVenda - posicao.precoUnitario!) / p.precoVenda <= tolerancia,
  );

  if (perto.length !== 1) return null;
  return perto[0];
}

/** O spread de recompra embutido, em pontos-base. Observado, nao assumido. */
export function spreadEmBps(preco: PrecoDoTesouro): number {
  return Math.round((preco.taxaVenda - preco.taxaCompra) * 10000) / 100;
}
