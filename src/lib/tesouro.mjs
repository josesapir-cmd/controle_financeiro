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

/** "01/03/2031" -> "2031-03-01". Fora desse formato, nulo. */
function data(bruta) {
  const casa = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(bruta.trim());
  return casa ? `${casa[3]}-${casa[2]}-${casa[1]}` : null;
}

/**
 * "19851,50" -> 19851.5.
 *
 * Virgula decimal e sem separador de milhar — e como o arquivo vem. Aceitar
 * ponto tambem nao custa nada e protege de uma troca de formato silenciosa.
 */
function numero(bruto) {
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
function achatar(texto) {
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
};

/**
 * Le o CSV inteiro.
 *
 * Linha que nao converte e ignorada em silencio de proposito: o arquivo tem
 * vinte e tantos anos de historico e uma linha estragada em 2009 nao pode
 * impedir de ler a de hoje.
 */
export function colunasDoPrecoTaxa(linha) {
  const colunas = linha.split(";").map(achatar);
  const em = (nome) => colunas.indexOf(nome);
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
  return Object.values(indices).some((i) => i === -1) ? null : indices;
}

/** Uma linha de dados. Devolve nulo para o que nao converte. */
export function lerLinhaDePrecoTaxa(indices, linha) {
  if (!linha.trim()) return null;
  const campos = linha.split(";");
  if (campos.length <= indices.precoVenda) return null;

  const titulo = (campos[indices.titulo] ?? "").trim();
  const vence = data(campos[indices.vence] ?? "");
  const base = data(campos[indices.base] ?? "");
  const taxaCompra = numero(campos[indices.taxaCompra] ?? "");
  const taxaVenda = numero(campos[indices.taxaVenda] ?? "");
  const precoCompra = numero(campos[indices.precoCompra] ?? "");
  const precoVenda = numero(campos[indices.precoVenda] ?? "");

  if (
    !titulo ||
    !vence ||
    !base ||
    taxaCompra === null ||
    taxaVenda === null ||
    precoCompra === null ||
    precoVenda === null
  ) {
    return null;
  }

  return { titulo, vence, base, taxaCompra, taxaVenda, precoCompra, precoVenda };
}

/**
 * Le o CSV inteiro, quando ele cabe na memoria.
 *
 * O arquivo publicado tem vinte e tantos anos de historico e dezenas de
 * megabytes — para ele existe a leitura linha a linha acima, que o script usa.
 * Esta versao serve aos testes e a um recorte ja filtrado.
 *
 * Linha que nao converte e ignorada em silencio de proposito: uma linha
 * estragada em 2009 nao pode impedir de ler a de hoje.
 */
export function lerPrecoTaxa(texto) {
  const linhas = texto.split(/\r?\n/);
  const cabecalho = linhas.findIndex((l) => achatar(l).startsWith(COLUNAS.titulo));
  if (cabecalho === -1) return [];

  const indices = colunasDoPrecoTaxa(linhas[cabecalho]);
  if (!indices) return [];

  const lidas = [];
  for (const linha of linhas.slice(cabecalho + 1)) {
    const lida = lerLinhaDePrecoTaxa(indices, linha);
    if (lida) lidas.push(lida);
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
export function doUltimoDia(precos) {
  if (precos.length === 0) return [];
  const ultimo = precos.reduce((maior, p) => (p.base > maior ? p.base : maior), precos[0].base);
  return precos.filter((p) => p.base === ultimo);
}

/**
 * Acha a linha do arquivo que corresponde a posicao.
 *
 * O VENCIMENTO manda, e o preco so desempata. A primeira versao casava pelo
 * preco e falhava exatamente onde precisava funcionar: o preco da corretora e
 * o dado defasado, entao exigir que ele bata com o oficial so acerta quando
 * nao havia nada a corrigir. Das quatro custodias da Renda+, so o Inter casava
 * — e era justamente o unico que ja estava certo.
 *
 * Dois titulos podem vencer no mesmo dia (um zero e um com juros semestrais).
 * Nesses casos o preco escolhe, com tolerancia larga de proposito: eles diferem
 * por estrutura, nao por dias de mercado. Empate de verdade devolve nulo — taxa
 * errada na tela e pior que nenhuma.
 *
 * Sem vencimento informado sobra o preco, e ai a exigencia volta a ser estreita:
 * sem outra ancora, so a coincidencia de preco sustenta a afirmacao.
 */
export function casarComOTitulo(posicao, precos, tolerancia = 0.001) {
  const pu = posicao.precoUnitario;

  if (posicao.vence) {
    const noVencimento = precos.filter((p) => p.vence === posicao.vence);
    if (noVencimento.length === 1) return noVencimento[0];

    if (noVencimento.length > 1) {
      if (pu === null || pu <= 0) return null;
      const porDistancia = [...noVencimento].sort(
        (a, b) => Math.abs(a.precoVenda - pu) - Math.abs(b.precoVenda - pu),
      );
      const [melhor, segundo] = porDistancia;
      // Dois candidatos praticamente equidistantes nao decidem nada.
      const folga =
        Math.abs(segundo.precoVenda - pu) - Math.abs(melhor.precoVenda - pu);
      return folga / melhor.precoVenda > 0.01 ? melhor : null;
    }
  }

  if (pu === null || pu <= 0) return null;

  const perto = precos.filter(
    (p) => p.precoVenda > 0 && Math.abs(p.precoVenda - pu) / p.precoVenda <= tolerancia,
  );

  return perto.length === 1 ? perto[0] : null;
}

/** O spread de recompra embutido, em pontos-base. Observado, nao assumido. */
export function spreadEmBps(preco) {
  return Math.round((preco.taxaVenda - preco.taxaCompra) * 10000) / 100;
}
