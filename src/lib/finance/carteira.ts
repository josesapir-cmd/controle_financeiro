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
  /**
   * Digitado a mao, fora do Open Finance.
   *
   * Nao e detalhe de exibicao: um numero que ninguem re-sincroniza envelhece
   * sozinho, e a tela precisa poder dizer isso. Por isso anda junto com o
   * papel, e nao numa lista paralela de ids.
   */
  manual?: boolean;
  /** So para o manual: quando este valor foi apurado. */
  avaliadoEm?: string | null;
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
  FIDC: "FIDC",
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
  CRYPTO: "Cripto",
  REAL_ESTATE: "Imovel",
  EQUITY_STAKE: "Participacao",
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

/** Onde um instrumento esta custodiado, e quanto dele esta ali. */
export interface CustodiaDoPapel {
  instituicao: string;
  saldo: number;
  lucro: number | null;
  taxa: number | null;
  posicoes: number;
}

/** Um instrumento, somando as posicoes que a corretora manda separadas. */
export interface PapelAgrupado extends PapelNaCarteira {
  /** Quantas posicoes foram somadas, contando todas as custodias. */
  posicoes: number;
  /** Sempre com pelo menos uma; mais de uma e o que merece expandir. */
  custodias: CustodiaDoPapel[];
}

/**
 * Uma linha por instrumento, com as custodias por dentro.
 *
 * A Pluggy manda uma posicao por lote comprado: cinco NTN-B 2084 compradas em
 * datas diferentes chegam como cinco linhas identicas no nome e no vencimento,
 * separadas so pelo valor. Isso e verdade contabil e ruido na leitura — quem
 * olha a tela quer saber quanto tem em Renda+ 2065, nao em qual ordem comprou.
 *
 * A custodia NAO entra na chave, mas tambem nao se perde: ela vira o nivel de
 * dentro. O total do instrumento e a pergunta de cima ("quanto tenho nisso"),
 * e onde esta custodiado e a pergunta de baixo — que so importa na hora de
 * resgatar, e por isso pode ficar guardada atras de um clique.
 */
/**
 * A chave do instrumento, indiferente ao que nao o distingue.
 *
 * O nome vem digitado pela corretora, e a mesma NTN-B chega ora com dois
 * espacos, ora com um, ora em caixa diferente. Isso nao faz dela outro papel —
 * mas separa as linhas na tela, e o sintoma e justamente o que se queria
 * resolver: lotes identicos que nao somam.
 *
 * O vencimento continua exato. Ele e o que separa de verdade dois titulos de
 * nome parecido, e normalizar data seria deixar de distinguir o que distingue.
 */
function chaveDoInstrumento(papel: PapelNaCarteira): string {
  const nome = papel.nome.trim().replace(/\s+/g, " ").toLocaleUpperCase("pt-BR");
  return `${nome}|${papel.vence ?? ""}`;
}

export function agruparPapeis(papeis: PapelNaCarteira[]): PapelAgrupado[] {
  const mapa = new Map<string, PapelAgrupado>();
  // Numerador e denominador da media de taxa, acumulados junto com o resto:
  // percorrer a lista de novo depois so para isso seria varrer n vezes o que ja
  // esta na mao.
  const taxaPonderada = new Map<string, { soma: number; peso: number }>();

  function ponderar(chave: string, papel: PapelNaCarteira) {
    // So as posicoes que informam taxa entram na media. Tratar a que nao
    // informa como zero diria que ela rendeu zero, que e outra afirmacao.
    if (papel.taxa === null || papel.saldo === 0) return;

    const acumulado = taxaPonderada.get(chave) ?? { soma: 0, peso: 0 };
    acumulado.soma += papel.taxa * papel.saldo;
    acumulado.peso += papel.saldo;
    taxaPonderada.set(chave, acumulado);
  }

  for (const papel of papeis) {
    const chave = chaveDoInstrumento(papel);
    const chaveDaCustodia = `${chave}|${papel.instituicao}`;
    const atual = mapa.get(chave);

    if (!atual) {
      mapa.set(chave, {
        ...papel,
        posicoes: 1,
        custodias: [
          {
            instituicao: papel.instituicao,
            saldo: papel.saldo,
            lucro: papel.lucro,
            taxa: papel.taxa,
            posicoes: 1,
          },
        ],
      });
    } else {
      atual.posicoes += 1;
      atual.saldo += papel.saldo;
      atual.aportado = somar(atual.aportado, papel.aportado);
      atual.lucro = somar(atual.lucro, papel.lucro);
      // Basta um membro digitado a mao para o grupo inteiro precisar do aviso:
      // parte do numero nao se re-sincroniza.
      atual.manual = atual.manual || papel.manual;

      const custodia = atual.custodias.find(
        (c) => c.instituicao === papel.instituicao,
      );
      if (custodia) {
        custodia.posicoes += 1;
        custodia.saldo += papel.saldo;
        custodia.lucro = somar(custodia.lucro, papel.lucro);
      } else {
        atual.custodias.push({
          instituicao: papel.instituicao,
          saldo: papel.saldo,
          lucro: papel.lucro,
          taxa: papel.taxa,
          posicoes: 1,
        });
      }
    }

    ponderar(chave, papel);
    ponderar(chaveDaCustodia, papel);
  }

  // A taxa e a media ponderada pelo saldo — a taxa daquela posicao inteira, e
  // nao a de um lote escolhido a esmo.
  for (const [chave, grupo] of mapa) {
    const media = (k: string) => {
      const a = taxaPonderada.get(k);
      return a && a.peso !== 0 ? a.soma / a.peso : null;
    };

    grupo.taxa = media(chave);
    for (const custodia of grupo.custodias) {
      custodia.taxa = media(`${chave}|${custodia.instituicao}`);
    }

    grupo.custodias.sort((a, b) => b.saldo - a.saldo);
    // Com uma custodia so, o nome dela e o do grupo; com varias, dizer o nome
    // de uma seria escolher uma para representar as outras.
    grupo.instituicao =
      grupo.custodias.length === 1
        ? grupo.custodias[0].instituicao
        : `${grupo.custodias.length} custodias`;
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
