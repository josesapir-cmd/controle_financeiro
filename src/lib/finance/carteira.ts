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
  /**
   * O usuario declarou que este papel e aquele instrumento.
   *
   * Quando ha declaracao ela manda sozinha: o vencimento sai da chave. Uma das
   * custodias pode nao informar data, e exigir que ela confira desfaria a
   * uniao que a pessoa acabou de fazer a mao.
   */
  apelidado?: boolean;
  /**
   * O mesmo papel depois do imposto, quando a instituicao informa.
   *
   * Anda junto com o bruto em vez de substitui-lo porque os dois sao
   * verdadeiros e respondem perguntas diferentes: quanto vale, e quanto
   * sobraria resgatando hoje.
   */
  liquido?: number | null;
  /** O que separa um do outro. */
  imposto?: number | null;
  /**
   * Remarcado ao preco oficial do Tesouro, na Data Base do arquivo.
   *
   * Anda junto com o papel porque muda o que a linha afirma: o valor deixou de
   * ser o que a corretora disse e passou a ser o que a fonte publica diz, e a
   * tela precisa poder mostrar de quando e.
   */
  precoOficialEm?: string | null;
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
  // Imposto ja retido na fonte. Nao rende e nao e resgatavel, mas abate o que
  // se vai dever: deixar fora da carteira e pagar duas vezes no pensamento.
  TAX_CREDIT: "Credito tributario",
};

/** O rotulo mais especifico que existir: subtipo antes de tipo. */
export function classeDoPapel(tipo: string, subtipo: string | null): string {
  if (subtipo && NOME_DA_CLASSE[subtipo]) return NOME_DA_CLASSE[subtipo];
  if (NOME_DO_TIPO[tipo]) return NOME_DO_TIPO[tipo];
  return subtipo || tipo;
}

/** Onde um instrumento esta custodiado, e quanto dele esta ali. */
export interface CustodiaDoPapel {
  instituicao: string;
  saldo: number;
  /** Somado como o saldo. Papel sem liquido informado entra com o bruto. */
  liquido: number;
  lucro: number | null;
  taxa: number | null;
  posicoes: number;
}

/** Um instrumento, somando as posicoes que a corretora manda separadas. */
export interface PapelAgrupado extends PapelNaCarteira {
  /** Quantas posicoes foram somadas, contando todas as custodias. */
  posicoes: number;
  /** O grupo reune papeis de vencimentos diferentes, entao `vence` e nulo. */
  vencimentosVariados?: boolean;
  /** Sempre com pelo menos uma; mais de uma e o que merece expandir. */
  custodias: CustodiaDoPapel[];
  /**
   * Onde os lotes deste instrumento estao na tabela regressiva do imposto.
   *
   * Vazio quando nenhum lote informa imposto — fundo e acao nao tem degrau.
   * Vive aqui, e nao numa tabela ao lado, porque e o MESMO dinheiro visto por
   * outro eixo: quem abre a linha ja esta perguntando o que ela esconde.
   */
  faixas: FaixaDeImposto[];
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
  const nome = papel.nome
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("pt-BR");
  // A declaracao do usuario e a autoridade: ela ja disse quais papeis sao o
  // mesmo, e o vencimento nao tem mais o que acrescentar.
  return papel.apelidado ? `apelido|${nome}` : `${nome}|${papel.vence ?? ""}`;
}

export function agruparPapeis(papeis: PapelNaCarteira[]): PapelAgrupado[] {
  const mapa = new Map<string, PapelAgrupado>();
  // Os lotes crus de cada grupo, guardados para as faixas de imposto: o
  // agrupado ja perdeu a aliquota de cada um ao somar.
  const lotes = new Map<string, PapelNaCarteira[]>();
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
        liquido: papel.liquido ?? papel.saldo,
        posicoes: 1,
        faixas: [],
        custodias: [
          {
            instituicao: papel.instituicao,
            saldo: papel.saldo,
            liquido: papel.liquido ?? papel.saldo,
            lucro: papel.lucro,
            taxa: papel.taxa,
            posicoes: 1,
          },
        ],
      });
    } else {
      atual.posicoes += 1;
      atual.saldo += papel.saldo;
      // Sem liquido informado entra o bruto: subestimar o resgate de um papel
      // porque a instituicao nao detalhou seria inventar um imposto.
      atual.liquido = (atual.liquido ?? 0) + (papel.liquido ?? papel.saldo);
      atual.aportado = somar(atual.aportado, papel.aportado);
      atual.lucro = somar(atual.lucro, papel.lucro);
      // Basta um membro digitado a mao para o grupo inteiro precisar do aviso:
      // parte do numero nao se re-sincroniza.
      atual.manual = atual.manual || papel.manual;
      // Basta um lote remarcado para o grupo inteiro poder dizer de quando e o
      // preco: todos os lotes do mesmo titulo sao marcados no mesmo dia.
      atual.precoOficialEm = atual.precoOficialEm ?? papel.precoOficialEm;
      // O vencimento so sobrevive se for o mesmo em todo o grupo.
      //
      // Data ausente e data desconhecida, nao data diferente: a XP manda a
      // NTN-B sem vencimento e o BTG manda com, e e a mesma. Mas juntar CDBs
      // de bancos diferentes junta vencimentos de verdade diferentes, e
      // mostrar o primeiro diria que os R$ 447 mil inteiros vencem naquele dia.
      if (papel.vence && atual.vence && papel.vence !== atual.vence) {
        atual.vence = null;
        atual.vencimentosVariados = true;
      } else if (!atual.vencimentosVariados) {
        atual.vence = atual.vence ?? papel.vence;
      }

      const custodia = atual.custodias.find(
        (c) => c.instituicao === papel.instituicao,
      );
      if (custodia) {
        custodia.posicoes += 1;
        custodia.saldo += papel.saldo;
        custodia.liquido += papel.liquido ?? papel.saldo;
        custodia.lucro = somar(custodia.lucro, papel.lucro);
      } else {
        atual.custodias.push({
          instituicao: papel.instituicao,
          saldo: papel.saldo,
          liquido: papel.liquido ?? papel.saldo,
          lucro: papel.lucro,
          taxa: papel.taxa,
          posicoes: 1,
        });
      }
    }

    ponderar(chave, papel);
    ponderar(chaveDaCustodia, papel);

    const daChave = lotes.get(chave);
    if (daChave) daChave.push(papel);
    else lotes.set(chave, [papel]);
  }

  // A taxa e a media ponderada pelo saldo — a taxa daquela posicao inteira, e
  // nao a de um lote escolhido a esmo.
  for (const [chave, grupo] of mapa) {
    const media = (k: string) => {
      const a = taxaPonderada.get(k);
      return a && a.peso !== 0 ? a.soma / a.peso : null;
    };

    grupo.taxa = media(chave);
    // Faixa sem aliquota conhecida nao vira linha: ela e o "nao sei", e uma
    // linha dizendo isso dentro do instrumento so tiraria espaco do que sei.
    grupo.faixas = porFaixaDeImposto(lotes.get(chave) ?? []).filter(
      (f) => f.aliquota !== null,
    );
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

/** O minimo que o credito de imposto precisa saber sobre um recebimento. */
export interface RetencaoNaFonte {
  fonte: string;
  /** Nulo enquanto nao houve pagamento — sem pagamento nao houve retencao. */
  pagoEm: string | null;
  retido: number;
}

/**
 * O imposto ja retido na fonte, como uma linha da carteira.
 *
 * Retencao nao e dinheiro perdido: e imposto pago adiantado, que abate o
 * devido no ajuste. Enquanto nao aparece em lugar nenhum, o patrimonio fica
 * menor do que e e a pessoa provisiona duas vezes o mesmo imposto.
 *
 * Somado, e nao uma linha por trimestre: sao pagamentos do mesmo credito
 * contra o mesmo ajuste, e treze linhas iguais diriam menos que uma.
 *
 * Derivado, e nao digitado. Um numero destes so cresce — a cada trimestre novo
 * o valor cadastrado a mao ficaria velho sem nenhum aviso na tela.
 */
export function creditoDeImpostoRetido(
  recebimentos: RetencaoNaFonte[],
): PapelNaCarteira | null {
  // Sem data de pagamento nao houve retencao: o trimestre foi apurado e nada
  // saiu. Contar essas linhas inventaria credito que nao existe.
  const pagos = recebimentos.filter((r) => r.pagoEm !== null && r.retido > 0);
  if (pagos.length === 0) return null;

  const total = pagos.reduce((soma, r) => soma + r.retido, 0);
  if (total < 0.005) return null;

  // Uma fonte so na maioria das vezes; com mais de uma o rotulo nao tenta
  // listar todas, porque o que a linha responde e "quanto ja foi retido".
  const fontes = [...new Set(pagos.map((r) => r.fonte))];
  const ultimo = pagos.reduce(
    (maisNovo, r) => (r.pagoEm! > maisNovo ? r.pagoEm! : maisNovo),
    pagos[0].pagoEm!,
  );

  return {
    id: "retencao:na-fonte",
    nome: "IR retido na fonte",
    instituicao: fontes.length === 1 ? fontes[0] : `${fontes.length} fontes`,
    tipo: "TAX_CREDIT",
    subtipo: null,
    saldo: total,
    aportado: null,
    lucro: null,
    taxa: null,
    vence: null,
    manual: true,
    // A data do ultimo recebimento, nao a de hoje: e ate ela que o numero
    // esta completo, e e isso que a tela precisa poder dizer.
    avaliadoEm: ultimo,
  };
}

/** Uma classe de papel, com os instrumentos dela por dentro. */
export interface ClasseDaCarteira {
  nome: string;
  saldo: number;
  /** Somado como o saldo, com o bruto no lugar do que nao foi informado. */
  liquido: number;
  aportado: number | null;
  lucro: number | null;
  /** Media ponderada pelo saldo das posicoes que informam taxa. */
  taxa: number | null;
  /** Quantas posicoes a classe soma, contando todos os instrumentos. */
  posicoes: number;
  /** O vencimento quando toda a classe compartilha um; nulo quando divergem. */
  vence: string | null;
  instrumentos: PapelAgrupado[];
}

/**
 * A carteira em tres niveis: classe, instrumento, custodia.
 *
 * A classe responde a pergunta de cima — "quanto tenho em CDB" — e nao depende
 * de ninguem declarar nada: o subtipo ja vem da corretora, e quatro custodias
 * que escrevem o nome do Tesouro de quatro jeitos mandam todas o mesmo subtipo.
 *
 * Os dois niveis de baixo existem porque a classe sozinha esconde o que
 * distingue: qual CDB, de que banco, vencendo quando. Guardados atras de um
 * clique, e nao apagados.
 */
export function agruparPorClasse(
  papeis: PapelNaCarteira[],
): ClasseDaCarteira[] {
  const porClasse = new Map<string, PapelNaCarteira[]>();

  for (const papel of papeis) {
    const classe = classeDoPapel(papel.tipo, papel.subtipo);
    const atual = porClasse.get(classe);
    if (atual) atual.push(papel);
    else porClasse.set(classe, [papel]);
  }

  const classes: ClasseDaCarteira[] = [];

  for (const [nome, daClasse] of porClasse) {
    const instrumentos = agruparPapeis(daClasse);
    const comTaxa = daClasse.filter((p) => p.taxa !== null && p.saldo !== 0);
    const peso = comTaxa.reduce((s, p) => s + p.saldo, 0);

    classes.push({
      nome,
      saldo: daClasse.reduce((s, p) => s + p.saldo, 0),
      liquido: daClasse.reduce((s, p) => s + (p.liquido ?? p.saldo), 0),
      aportado: daClasse.reduce<number | null>(
        (s, p) => somar(s, p.aportado),
        null,
      ),
      lucro: daClasse.reduce<number | null>((s, p) => somar(s, p.lucro), null),
      // Mesma regra dos outros niveis: so quem informa taxa entra na media.
      taxa:
        peso !== 0
          ? comTaxa.reduce((s, p) => s + (p.taxa ?? 0) * p.saldo, 0) / peso
          : null,
      posicoes: daClasse.length,
      // Mesma regra dos niveis de baixo: a data so sobrevive se for uma so.
      // Tres NTN-B 2084 na classe Tesouro tem vencimento; tres CDBs de bancos
      // diferentes nao tem, e mostrar o de um diria que a classe toda vence la.
      vence: (() => {
        const datas = new Set(daClasse.map((p) => p.vence).filter(Boolean));
        return datas.size === 1 ? [...datas][0]! : null;
      })(),
      instrumentos,
    });
  }

  return classes.sort((a, b) => b.saldo - a.saldo);
}

/** O preco oficial de um titulo do Tesouro, como a carteira precisa dele. */
export interface PrecoOficial {
  /** A taxa da curva, sem o spread de recompra. */
  taxaCompra: number;
  /** O preco pelo qual o Tesouro recompra hoje. */
  precoVenda: number;
  /** A Data Base do arquivo. */
  em: string;
}

/**
 * A posicao remarcada ao preco oficial do Tesouro.
 *
 * Quatro custodias mandam quatro precos para o MESMO titulo — 186,95, 188,48 e
 * 189,12 para a Renda+ 2065 — e so uma batia com o Tesouro. As outras nao
 * estao erradas de metodologia: estao com preco velho, e cada uma atualiza
 * quando quer. Num papel de quarenta e tres anos de duration, 1,16% de preco
 * sao 2,7 pontos-base, ou seja, poucos dias de mercado, e R$ 54 mil de
 * patrimonio que nao existe.
 *
 * Para o Tesouro Direto existe UM preco oficial por dia. Entao a corretora
 * passa a informar so a quantidade, que ela sabe, e o preco vem da fonte.
 *
 * O imposto e reescalado pelo lucro, e nao copiado: ele foi calculado sobre um
 * bruto maior, e manter o numero velho ao lado de um bruto novo daria um
 * liquido pior que qualquer das duas versoes. A aliquota de cada lote se
 * preserva porque a conta e feita lote a lote.
 */
export function remarcarAoPrecoOficial(
  papel: PapelNaCarteira,
  quantidade: number | null,
  preco: PrecoOficial,
): PapelNaCarteira {
  // Sem quantidade nao ha o que remarcar: o preco sozinho nao diz o tamanho da
  // posicao, e inventar um seria pior que deixar o numero da corretora.
  if (quantidade === null || quantidade <= 0) return papel;

  const bruto = quantidade * preco.precoVenda;
  if (!Number.isFinite(bruto) || bruto <= 0) return papel;

  const impostoAntigo = papel.imposto ?? 0;
  const brutoAntigo = papel.saldo;
  const investido = papel.aportado;

  // Lucro velho perto de zero nao da escala confiavel — nesse caso o imposto
  // tambem e perto de zero, e leva-lo inteiro nao move nada.
  const lucroAntigo = investido === null ? null : brutoAntigo - investido;
  const lucroNovo = investido === null ? null : bruto - investido;

  const imposto =
    lucroAntigo !== null && lucroNovo !== null && Math.abs(lucroAntigo) > 0.01
      ? Math.max(0, (impostoAntigo * lucroNovo) / lucroAntigo)
      : impostoAntigo;

  return {
    ...papel,
    saldo: bruto,
    liquido: bruto - imposto,
    imposto,
    // A taxa da curva substitui a contratada: a pergunta que a linha responde
    // passa a ser "a quanto o mercado marca isto hoje".
    taxa: preco.taxaCompra,
    precoOficialEm: preco.em,
  };
}

/**
 * A tabela regressiva do imposto sobre renda fixa.
 *
 * A aliquota cai com o tempo de aplicacao, e cai em degraus: no dia 721 um
 * lote que pagava 17,5% passa a pagar 15%. Quem sabe onde cada lote esta na
 * tabela sabe quando resgatar sem doar imposto.
 */
export const FAIXAS_DE_IMPOSTO = [
  { aliquota: 22.5, de: 0, ate: 180 },
  { aliquota: 20, de: 181, ate: 360 },
  { aliquota: 17.5, de: 361, ate: 720 },
  { aliquota: 15, de: 721, ate: null },
] as const;

export interface FaixaDeImposto {
  /** 22,5 / 20 / 17,5 / 15, ou nulo para o que nao informa imposto. */
  aliquota: number | null;
  /** Dias de aplicacao que colocam um lote nesta faixa. */
  de: number | null;
  ate: number | null;
  investido: number;
  bruto: number;
  imposto: number;
  posicoes: number;
}

/**
 * A aliquota que a instituicao aplicou a este lote.
 *
 * Sai do proprio numero — imposto dividido pelo lucro — em vez de precisar da
 * data da compra, que a Pluggy nao manda. Ela vem com ruido de arredondamento,
 * entao e encaixada no degrau mais proximo; longe demais de qualquer um, nao e
 * a tabela regressiva e fica de fora.
 */
export function aliquotaDoLote(papel: PapelNaCarteira): number | null {
  const imposto = papel.imposto;
  const investido = papel.aportado;
  if (imposto === null || imposto === undefined || investido === null) return null;

  const lucro = papel.saldo - investido;
  // Lucro perto de zero nao sustenta a divisao: uma diferenca de centavos no
  // denominador vira dezenas de pontos percentuais na aliquota.
  if (lucro <= 1) return null;

  const bruta = (imposto / lucro) * 100;
  let melhor: number | null = null;
  let distancia = Infinity;

  for (const faixa of FAIXAS_DE_IMPOSTO) {
    const d = Math.abs(faixa.aliquota - bruta);
    if (d < distancia) {
      distancia = d;
      melhor = faixa.aliquota;
    }
  }

  // Meio ponto percentual e folga de arredondamento; alem disso e outra coisa.
  return distancia <= 0.5 ? melhor : null;
}

/**
 * Quanto esta em cada degrau da tabela regressiva.
 *
 * Ordenado da aliquota mais alta para a mais baixa: e a ordem em que os lotes
 * andam com o tempo, e a primeira linha e a que mais tem a ganhar esperando.
 * O que nao informa imposto entra numa faixa sem aliquota, em vez de sumir —
 * some-lo as outras diria que o patrimonio inteiro e renda fixa tributada.
 */
export function porFaixaDeImposto(papeis: PapelNaCarteira[]): FaixaDeImposto[] {
  const vazia = (aliquota: number | null, de: number | null, ate: number | null) => ({
    aliquota,
    de,
    ate,
    investido: 0,
    bruto: 0,
    imposto: 0,
    posicoes: 0,
  });

  const faixas = new Map<string, FaixaDeImposto>(
    FAIXAS_DE_IMPOSTO.map((f) => [
      String(f.aliquota),
      vazia(f.aliquota, f.de, f.ate),
    ]),
  );
  faixas.set("sem", vazia(null, null, null));

  for (const papel of papeis) {
    const aliquota = aliquotaDoLote(papel);
    const faixa = faixas.get(aliquota === null ? "sem" : String(aliquota))!;
    faixa.investido += papel.aportado ?? 0;
    faixa.bruto += papel.saldo;
    faixa.imposto += papel.imposto ?? 0;
    faixa.posicoes += 1;
  }

  return [...faixas.values()].filter((f) => f.posicoes > 0);
}
