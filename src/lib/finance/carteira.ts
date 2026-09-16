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
