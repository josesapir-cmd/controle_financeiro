export interface PapelNaCarteira {
  id: string;
  nome: string;
  instituicao: string;
  tipo: string;
  subtipo: string | null;
  saldo: number;
  aportado: number | null;
  lucro: number | null;
  taxa: number | null;
  vence: string | null;
}

export interface GrupoDaCarteira {
  /** Rotulo legivel do tipo ou subtipo — "Tesouro", "CDB", "Fundo". */
  nome: string;
  total: number;
  papeis: number;
}

/**
 * Como chamar cada classe de papel em portugues.
 *
 * A Pluggy manda o codigo do Open Finance. Um mapa aqui, e nao na tela, porque
 * a mesma traducao serve o agrupamento e a lista — e duas traducoes do mesmo
 * codigo seriam dois nomes para a mesma coisa na mesma pagina.
 */
const NOME_DA_CLASSE: Record<string, string> = {
  TREASURY: "Tesouro Direto",
  CDB: "CDB",
  LCI: "LCI",
  LCA: "LCA",
  DEBENTURES: "Debentures",
  CRI: "CRI",
  CRA: "CRA",
  INVESTMENT_FUND: "Fundo de investimento",
  MULTIMARKET_FUND: "Fundo multimercado",
  EQUITY_FUND: "Fundo de acoes",
  FIXED_INCOME_FUND: "Fundo de renda fixa",
  ETF: "ETF",
  STOCK: "Acoes",
  COE: "COE",
  PENSION: "Previdencia",
};

const NOME_DO_TIPO: Record<string, string> = {
  FIXED_INCOME: "Renda fixa",
  MUTUAL_FUND: "Fundo",
  EQUITY: "Renda variavel",
  SECURITY: "Titulo",
  COE: "COE",
  PENSION: "Previdencia",
  ETF: "ETF",
};

/** O rotulo mais especifico que existir: subtipo antes de tipo. */
export function classeDoPapel(tipo: string, subtipo: string | null): string {
  if (subtipo && NOME_DA_CLASSE[subtipo]) return NOME_DA_CLASSE[subtipo];
  if (NOME_DO_TIPO[tipo]) return NOME_DO_TIPO[tipo];
  return subtipo || tipo;
}

export function agrupar(
  papeis: PapelNaCarteira[],
  chave: (papel: PapelNaCarteira) => string,
): GrupoDaCarteira[] {
  const mapa = new Map<string, GrupoDaCarteira>();

  for (const papel of papeis) {
    const nome = chave(papel);
    const atual = mapa.get(nome) ?? { nome, total: 0, papeis: 0 };
    atual.total += papel.saldo;
    atual.papeis += 1;
    mapa.set(nome, atual);
  }

  return [...mapa.values()].sort((a, b) => b.total - a.total);
}

/** Um instrumento, somando as posicoes que a corretora manda separadas. */
export interface PapelAgrupado extends PapelNaCarteira {
  /** Quantas posicoes a corretora mandou para este mesmo instrumento. */
  posicoes: number;
}

/**
 * Uma linha por instrumento, vencimento e custodia.
 *
 * A Pluggy manda uma posicao por lote comprado: cinco NTN-B 2084 compradas em
 * datas diferentes chegam como cinco linhas identicas no nome e no vencimento,
 * separadas so pelo valor. Isso e verdade contabil e ruido na leitura — quem
 * olha a tela quer saber quanto tem em NTN-B 2084 no BTG, nao em qual ordem
 * comprou.
 *
 * A custodia entra na chave de proposito: o MESMO titulo em duas corretoras sao
 * duas posicoes que se resgatam separado, e junta-las esconderia onde o dinheiro
 * esta.
 */
export function agruparPapeis(papeis: PapelNaCarteira[]): PapelAgrupado[] {
  const mapa = new Map<string, PapelAgrupado>();
  // Numerador e denominador da media de taxa, acumulados junto com o resto:
  // percorrer a lista de novo depois so para isso seria varrer n vezes o que ja
  // esta na mao.
  const taxaPonderada = new Map<string, { soma: number; peso: number }>();

  for (const papel of papeis) {
    const chave = `${papel.nome}|${papel.vence ?? ""}|${papel.instituicao}`;
    const atual = mapa.get(chave);

    if (!atual) {
      mapa.set(chave, { ...papel, posicoes: 1 });
    } else {
      atual.posicoes += 1;
      atual.saldo += papel.saldo;
      atual.aportado = somar(atual.aportado, papel.aportado);
      atual.lucro = somar(atual.lucro, papel.lucro);
    }

    // So as posicoes que informam taxa entram na media. Tratar a que nao
    // informa como zero diria que ela rendeu zero, que e outra afirmacao.
    if (papel.taxa !== null && papel.saldo !== 0) {
      const acumulado = taxaPonderada.get(chave) ?? { soma: 0, peso: 0 };
      acumulado.soma += papel.taxa * papel.saldo;
      acumulado.peso += papel.saldo;
      taxaPonderada.set(chave, acumulado);
    }
  }

  // A taxa do grupo e a media ponderada pelo saldo — a taxa daquela posicao
  // inteira, e nao a de um lote escolhido a esmo.
  for (const [chave, grupo] of mapa) {
    const acumulado = taxaPonderada.get(chave);
    grupo.taxa =
      acumulado && acumulado.peso !== 0
        ? acumulado.soma / acumulado.peso
        : null;
  }

  return [...mapa.values()].sort((a, b) => b.saldo - a.saldo);
}

/** Soma que preserva o `null`: sem nenhum informante, o resultado e desconhecido. */
function somar(a: number | null, b: number | null): number | null {
  if (a === null) return b;
  if (b === null) return a;
  return a + b;
}

/**
 * Papel resgatado que a instituicao ainda lista.
 *
 * Saldo zero nao e patrimonio: ocupa linha, entra na contagem de "N papeis" e
 * nao acrescenta nada. Some da tela inteira, e nao so da tabela, para a
 * contagem do resumo continuar dizendo a verdade.
 */
export function semZerados(papeis: PapelNaCarteira[]): PapelNaCarteira[] {
  return papeis.filter((papel) => Math.abs(papel.saldo) >= 0.005);
}
