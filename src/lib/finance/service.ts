import "server-only";

import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  counterpartyFingerprint,
  listAccounts,
  listChamadas,
  listCompromissos,
  listRegrasDeCartao,
  listRotulosDeCompra,
  purchaseFingerprint,
  listCategorias,
  listCentrosDeCusto,
  listCounterpartyLinks,
  listTransactionLabels,
  listTransactionProducts,
  ultimoDiaPorConta,
  type CategoriaRow,
  type CentroDeCustoRow,
  listLabels,
  listTransactions,
  listarImportacoes,
  syncStatus,
  type AccountRow,
  type SyncStatus,
} from "@/lib/db/repository";
import { classificarParaConferencia } from "@/lib/importacao/linhas";
import { mockAccounts, mockItems, mockTransactions } from "@/lib/pluggy/mock";
import type { AccountWithConnector, Transaction } from "@/lib/pluggy/types";
import { classify, translateCategory } from "./categories";
import {
  cruzarCentrosDeCusto,
  totalPorTipo,
  type CategoriaTotal,
} from "./centros";
import {
  chaveEfetiva,
  mapaDeConciliacao,
  sugerirConciliacoes,
  type Candidata,
  type Sugestao,
} from "./conciliacao";
import {
  aggregateCounterparties,
  chaveIdentificada,
  type CounterpartyRegistry,
  type CounterpartyTotal,
} from "./counterparties";
import { isUserInitiatedExpense } from "./automatic";
import { maskDocument, normalizeName } from "./counterparties";
import {
  currentMonthRange,
  currentYearRange,
  localDay,
  localTime,
  shiftDay,
  shiftMonth,
} from "./dates";
import { netWorth, normalizeAmount, sumBy } from "./money";
import { rotuloDoLancamento } from "./rotulo";
import { fronteiraDeDados, situacaoDoDia, type SituacaoDoDia } from "./situacao";
import { corDeGrafico } from "./cores-de-conta";
import { dadosDoCartao, rotuloDaParcela } from "./cartao";
import { categoriaDoMcc } from "./mcc";
import { chaveDaCompra } from "./parcelamento";
import { classificar, estaClassificado, type Atribuicao } from "./classificacao";
import { montarCarteira, type CarteiraDeCompromissos } from "./compromissos";
import {
  totalExpenses,
  totalIncome,
  totalTransfers,
  totalsByCategory,
  type CategoryTotal,
} from "./summary";

/**
 * Fonte de dados das telas.
 *
 * Le do banco, nunca da Pluggy. A API e alcancada apenas pelo job de
 * sincronizacao — ver docs/arquitetura.md. Isso torna as telas rapidas, faz o
 * app sobreviver a uma conexao caida ou a um consentimento vencido, e preserva
 * o historico quando uma conexao e removida no Meu Pluggy.
 */

export interface Period {
  from: string;
  to: string;
}

/** Uniao (ou separacao) de contrapartes ja decidida pelo usuario. */
export interface Decisao {
  de: string;
  /** null significa "sao contrapartes diferentes mesmo". */
  para: string | null;
  nomeDe: string;
  nomePara?: string;
}

export interface AccountOption {
  id: string;
  label: string;
  connectorName: string;
}

function useMock(): boolean {
  return process.env.PLUGGY_MOCK === "true";
}

function db(): Db {
  return fromPostgres(getSql());
}

function paraContaExibivel(conta: AccountRow): AccountWithConnector {
  return {
    id: conta.id,
    itemId: conta.itemId ?? "",
    type: conta.type,
    subtype: conta.subtype ?? undefined,
    name: conta.name ?? conta.connectorName,
    number: conta.number ?? undefined,
    balance: conta.balance,
    currencyCode: conta.currency,
    connectorName: conta.connectorName,
    origin: conta.origin === "manual" ? "manual" : "pluggy",
  };
}

/**
 * Contas com saldo apurado.
 *
 * A conta virtual do saldo compartilhado registra gastos, nao saldo: ninguem
 * nos informa quanto sobrou la. Ela precisa aparecer no filtro e nos
 * lancamentos, mas somar seu zero ao patrimonio seria afirmar um saldo que nao
 * medimos — entao os totais de saldo a ignoram.
 */
function comSaldo(contas: AccountWithConnector[]): AccountWithConnector[] {
  return contas.filter((conta) => conta.origin !== "manual");
}

/** Converte a linha do banco para a forma que os agregadores ja consomem. */
function paraTransacao(linha: Awaited<ReturnType<typeof listTransactions>>[number]): Transaction {
  return {
    id: linha.id,
    accountId: linha.accountId,
    description: linha.description ?? "",
    amount: linha.amount,
    currencyCode: linha.currency,
    date: linha.postedAt.toISOString(),
    category: linha.category,
    categoryId: linha.categoryId,
    details: linha.details ?? undefined,
    counterparty: linha.counterpartyFingerprint
      ? {
          // A chave passa a ser o fingerprint: e o que o banco agrupa e o que o
          // cadastro de rotulos usa.
          key: linha.counterpartyFingerprint,
          name: linha.counterpartyName ?? undefined,
          document: linha.counterpartyDocument ?? undefined,
          self: linha.counterpartySelf,
        }
      : null,
  };
}

async function carregar(
  periodo: Period,
  accountIds: string[],
): Promise<{
  contas: AccountWithConnector[];
  todasAsContas: AccountWithConnector[];
  transacoes: Transaction[];
  registry: CounterpartyRegistry;
  status: SyncStatus[];
  decisoes: Record<string, string | null>;
}> {
  if (useMock()) {
    const todas = mockAccounts.map((conta) => ({
      ...conta,
      connectorName: mockItems[0].connector.name,
      connectorPrimaryColor: mockItems[0].connector.primaryColor,
    }));
    const selecionadas = accountIds.length
      ? todas.filter((c) => accountIds.includes(c.id))
      : todas;

    const transacoes = selecionadas.flatMap((conta) =>
      mockTransactions(conta.id, new Date(`${periodo.to}T12:00:00Z`)).map((t) => ({
        ...t,
        amount: normalizeAmount(t.amount, conta.type),
      })),
    );

    return {
      contas: selecionadas,
      todasAsContas: todas,
      transacoes,
      registry: {},
      status: [],
      decisoes: {},
    };
  }

  const conexao = db();
  const [contasBrutas, linhas, rotulos, estado, decisoes] = await Promise.all([
    listAccounts(conexao),
    listTransactions(conexao, { ...periodo, accountIds }),
    listLabels(conexao),
    syncStatus(conexao),
    listCounterpartyLinks(conexao),
  ]);

  const todasAsContas = contasBrutas.map(paraContaExibivel);
  const contas = accountIds.length
    ? todasAsContas.filter((c) => accountIds.includes(c.id))
    : todasAsContas;

  const registry: CounterpartyRegistry = {};
  for (const rotulo of rotulos) {
    registry[rotulo.fingerprint] = {
      category: rotulo.category ?? undefined,
      subcategory: rotulo.subcategory ?? undefined,
      alias: rotulo.alias ?? undefined,
      officialName: rotulo.officialName ?? undefined,
    };
  }

  return {
    contas,
    todasAsContas,
    transacoes: linhas.map(paraTransacao),
    registry,
    status: estado,
    decisoes,
  };
}

/**
 * Aplica a conciliacao de contrapartes as transacoes do periodo.
 *
 * Um nome recortado de print e o nome inteiro do Open Finance sao a mesma
 * contraparte; sem isso o historico e a classificacao ficam partidos em dois. A
 * uniao acontece aqui, reescrevendo a chave antes de agregar, e nao no banco: o
 * fingerprint gravado e um HMAC, entao so na aplicacao — com os nomes ja
 * decifrados — da para ver que um e comeco do outro.
 *
 * Devolve tambem as sugestoes, porque a tela precisa mostrar o que foi unido
 * sozinho (para poder ser desfeito) e o que espera decisao.
 */
function conciliar(
  transacoes: Transaction[],
  decisoes: Record<string, string | null>,
): { transacoes: Transaction[]; sugestoes: Sugestao[]; decididas: Decisao[] } {
  const candidatas = new Map<string, Candidata>();

  for (const t of transacoes) {
    const c = t.counterparty;
    if (!c) continue;

    const atual = candidatas.get(c.key);
    if (atual) {
      atual.count += 1;
      // O nome mais longo representa o balde: e o que tem chance de ser o
      // completo, e a comparacao por prefixo depende dele.
      if (c.name && c.name.length > atual.name.length) atual.name = c.name;
      if (c.document) atual.hasDocument = true;
    } else {
      candidatas.set(c.key, {
        key: c.key,
        name: c.name ?? "",
        hasDocument: Boolean(c.document),
        count: 1,
      });
    }
  }

  const sugestoes = sugerirConciliacoes([...candidatas.values()], decisoes);
  const mapa = mapaDeConciliacao(sugestoes, decisoes);

  // Decisoes ja tomadas, para a tela poder mostra-las e desfaze-las. So as que
  // aparecem nos dados do periodo: as outras nao teriam nome para exibir.
  const nome = (chave: string) => candidatas.get(chave)?.name || chave;
  const decididas: Decisao[] = Object.entries(decisoes)
    .filter(([de]) => candidatas.has(de))
    .map(([de, para]) => ({
      de,
      para,
      nomeDe: nome(de),
      nomePara: para ? nome(para) : undefined,
    }));

  if (Object.keys(mapa).length === 0) return { transacoes, sugestoes, decididas };

  return {
    transacoes: transacoes.map((t) =>
      t.counterparty
        ? { ...t, counterparty: { ...t.counterparty, key: chaveEfetiva(t.counterparty.key, mapa) } }
        : t,
    ),
    sugestoes,
    decididas,
  };
}

/**
 * O rotulo segue a contraparte unida.
 *
 * Se o usuario ja tinha classificado o nome recortado antes da uniao, essa
 * classificacao nao pode se perder ao virar outra chave — perder trabalho ja
 * feito e a maneira mais rapida de o usuario parar de classificar.
 */
function herdarRotulos(
  registry: CounterpartyRegistry,
  sugestoes: Sugestao[],
  decisoes: Record<string, string | null>,
): CounterpartyRegistry {
  const mapa = mapaDeConciliacao(sugestoes, decisoes);
  const resultado: CounterpartyRegistry = { ...registry };

  for (const [de, para] of Object.entries(mapa)) {
    const origem = registry[de];
    if (!origem) continue;

    const destino = resultado[para] ?? {};
    resultado[para] = {
      // O que o destino ja tinha vence: e o cadastro da contraparte que
      // sobreviveu a uniao.
      category: destino.category ?? origem.category,
      subcategory: destino.subcategory ?? origem.subcategory,
      alias: destino.alias ?? origem.alias,
      officialName: destino.officialName ?? origem.officialName,
    };
  }

  return resultado;
}

function opcoes(contas: AccountWithConnector[]): AccountOption[] {
  return contas.map((conta) => ({
    id: conta.id,
    label: conta.marketingName || conta.name,
    connectorName: conta.connectorName,
  }));
}

/** Conexoes que falharam na ultima sincronizacao, para avisar sem esconder o resto. */
function falhas(status: SyncStatus[]): { itemId: string; message: string }[] {
  return status
    .filter((s) => s.lastSyncError)
    .map((s) => ({ itemId: s.itemId, message: `${s.connectorName}: ${s.lastSyncError}` }));
}

export interface DashboardData {
  accounts: AccountWithConnector[];
  transactions: Transaction[];
  categories: CategoryTotal[];
  netWorth: number;
  cashBalance: number;
  creditBalance: number;
  income: number;
  expenses: number;
  transfers: number;
  period: Period;
  failures: { itemId: string; message: string }[];
  isMock: boolean;
  accountOptions: AccountOption[];
  selectedAccountIds: string[];
  syncedAt: Date | null;
  /** Leituras de print esperando conferencia — dinheiro ainda fora do painel. */
  importacoesPendentes: number;
}

/** Data da sincronizacao mais antiga entre as conexoes: e a que limita a confianca. */
function sincronizadoEm(status: SyncStatus[]): Date | null {
  const datas = status.map((s) => s.lastSyncedAt).filter((d): d is Date => Boolean(d));
  return datas.length ? new Date(Math.min(...datas.map((d) => d.getTime()))) : null;
}

export async function loadDashboard(
  reference: Date = new Date(),
  options: { accountIds?: string[] } = {},
): Promise<DashboardData> {
  const period = currentMonthRange(reference);
  const accountIds = options.accountIds ?? [];
  const [{ contas, todasAsContas, transacoes, status }, importacoesPendentes] = await Promise.all([
    carregar(period, accountIds),
    contarImportacoesPendentes(),
  ]);

  const saldos = comSaldo(contas);

  return {
    accounts: saldos,
    transactions: transacoes,
    categories: totalsByCategory(transacoes),
    netWorth: netWorth(saldos),
    cashBalance: sumBy(saldos, "BANK"),
    creditBalance: sumBy(saldos, "CREDIT"),
    income: totalIncome(transacoes),
    expenses: totalExpenses(transacoes),
    transfers: totalTransfers(transacoes),
    period,
    failures: falhas(status),
    isMock: useMock(),
    accountOptions: opcoes(todasAsContas),
    selectedAccountIds: accountIds,
    syncedAt: sincronizadoEm(status),
    importacoesPendentes,
  };
}

export interface DayData {
  day: string;
  transactions: Transaction[];
  spent: number;
  received: number;
  transfers: number;
  failures: { itemId: string; message: string }[];
  isMock: boolean;
  accountNames: Record<string, string>;
  accountOptions: AccountOption[];
  selectedAccountIds: string[];
}

export async function loadDay(
  day: string,
  options: { accountIds?: string[] } = {},
): Promise<DayData> {
  const accountIds = options.accountIds ?? [];
  const { contas, todasAsContas, transacoes, status } = await carregar(
    { from: day, to: day },
    accountIds,
  );

  const doDia = transacoes.filter((t) => localDay(t.date) === day);
  doDia.sort((a, b) => a.date.localeCompare(b.date));

  const accountNames: Record<string, string> = {};
  for (const conta of contas) accountNames[conta.id] = conta.marketingName || conta.name;

  return {
    day,
    transactions: doDia,
    spent: totalExpenses(doDia),
    received: totalIncome(doDia),
    transfers: totalTransfers(doDia),
    failures: falhas(status),
    isMock: useMock(),
    accountNames,
    accountOptions: opcoes(todasAsContas),
    selectedAccountIds: accountIds,
  };
}

export interface CounterpartiesData {
  counterparties: CounterpartyTotal[];
  period: Period;
  totalSent: number;
  totalReceived: number;
  internalCount: number;
  accountNames: Record<string, string>;
  accountOptions: AccountOption[];
  selectedAccountIds: string[];
  failures: { itemId: string; message: string }[];
  isMock: boolean;
  /** Unioes aplicadas sozinhas e as que esperam decisao. */
  conciliacoes: Sugestao[];
  /** Decisoes ja registradas pelo usuario, para poderem ser revistas. */
  conciliacoesDecididas: Decisao[];
}

export async function loadCounterparties(
  period: Period,
  options: { includeInternal?: boolean; accountIds?: string[] } = {},
): Promise<CounterpartiesData> {
  const accountIds = options.accountIds ?? [];
  const { contas, todasAsContas, transacoes, registry, status, decisoes } = await carregar(
    period,
    accountIds,
  );

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);

  // Transferencia entre contas proprias e aplicacao nao sao contraparte: o
  // dinheiro mudou de bolso dentro do proprio patrimonio.
  const relevantes = options.includeInternal
    ? conciliado.transacoes
    : conciliado.transacoes.filter((t) => !t.counterparty?.self && classify(t) !== "transfer");

  const counterparties = aggregateCounterparties(relevantes, cadastro);

  const accountNames: Record<string, string> = {};
  for (const conta of contas) {
    accountNames[conta.id] = `${conta.connectorName} · ${conta.name}`;
  }

  return {
    counterparties,
    period,
    totalSent: counterparties.reduce((total, c) => total + c.sent, 0),
    totalReceived: counterparties.reduce((total, c) => total + c.received, 0),
    internalCount: transacoes.length - relevantes.length,
    accountNames,
    accountOptions: opcoes(todasAsContas),
    selectedAccountIds: accountIds,
    failures: falhas(status),
    isMock: useMock(),
    conciliacoes: conciliado.sugestoes,
    conciliacoesDecididas: conciliado.decididas,
  };
}

export interface ConnectionRow {
  itemId: string;
  connectorName: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  accounts: number;
}

export async function loadConnections(): Promise<ConnectionRow[]> {
  if (useMock()) {
    return [
      {
        itemId: mockItems[0].id,
        connectorName: mockItems[0].connector.name,
        lastSyncedAt: new Date(),
        lastSyncError: null,
        accounts: mockAccounts.length,
      },
    ];
  }

  const conexao = db();
  const [estado, contas] = await Promise.all([syncStatus(conexao), listAccounts(conexao)]);

  return estado.map((s) => ({
    ...s,
    accounts: contas.filter((c) => c.itemId === s.itemId).length,
  }));
}

/**
 * Sugestoes para os campos de classificacao.
 *
 * Vem da taxonomia, nao do que ja foi usado: uma categoria criada na aba de
 * categorias precisa aparecer aqui antes de ter a primeira contraparte. O que
 * ja esta gravado nos rotulos entra junto, para nao perder nada que exista so
 * como texto.
 */
export async function loadTaxonomy(): Promise<{ categories: string[]; subcategories: string[] }> {
  if (useMock()) return { categories: [], subcategories: [] };

  const conexao = db();
  const [rotulos, categorias, centros] = await Promise.all([
    listLabels(conexao),
    listCategorias(conexao),
    listCentrosDeCusto(conexao),
  ]);

  const nomes = new Set<string>(categorias.map((c) => c.name));
  const subnomes = new Set<string>(centros.map((c) => c.name));

  for (const rotulo of rotulos) {
    if (rotulo.category) nomes.add(rotulo.category);
    if (rotulo.subcategory) subnomes.add(rotulo.subcategory);
  }

  const ordenar = (a: string, b: string) => a.localeCompare(b, "pt-BR");
  return {
    categories: [...nomes].sort(ordenar),
    subcategories: [...subnomes].sort(ordenar),
  };
}

export interface ImportacaoResumo {
  id: string;
  createdAt: Date;
  status: string;
  images: number;
  envios: number;
  linhas: number;
  /** Soma das saidas do lote, como numero positivo. */
  saidas: number;
  /** Linhas repetidas entre envios: exigem decisao de quem viu as telas. */
  decidir: number;
  /** Linhas lidas com confianca menor que alta: valem uma olhada. */
  conferir: number;
}

/**
 * Lotes lidos de prints do saldo compartilhado, do mais recente ao mais antigo.
 *
 * Existe para separar o envio da aprovacao: da para fotografar no celular e
 * conferir no desktop depois. Um lote pendente esquecido e dinheiro que
 * continua fora do controle, entao ele aparece aqui, na tela de conexoes e no
 * painel ate ser resolvido.
 */
export async function loadImportacoes(limite = 5): Promise<ImportacaoResumo[]> {
  if (useMock()) return [];

  const lotes = await listarImportacoes(db(), limite);

  return lotes.map((lote) => {
    const { decidir, conferir } = classificarParaConferencia(lote.linhas);

    return {
      id: lote.id,
      createdAt: lote.createdAt,
      status: lote.status,
      images: lote.images,
      envios: lote.envios,
      linhas: lote.linhas.length,
      saidas: lote.linhas.reduce((total, l) => (l.valor < 0 ? total - l.valor : total), 0),
      decidir: decidir.length,
      conferir: conferir.length,
    };
  });
}

/** Quantos lotes esperam conferencia. Barato o bastante para o painel chamar. */
export async function contarImportacoesPendentes(): Promise<number> {
  if (useMock()) return 0;

  try {
    const linhas = await db().query<{ total: string }>(
      "SELECT count(*) AS total FROM shared_imports WHERE status = 'pendente'",
    );
    return Number(linhas[0]?.total ?? 0);
  } catch {
    // A tabela pode nao existir ainda (migracao pendente). Um painel que quebra
    // por causa de um aviso e pior do que um painel sem o aviso.
    return 0;
  }
}

export interface CentrosDeCustoData {
  categorias: CategoriaTotal[];
  /**
   * Os mesmos totais no ano corrente. Os blocos mostram mes e ano lado a lado:
   * o mes diz o que esta acontecendo, o ano diz o tamanho da categoria.
   */
  noAno: CategoriaTotal[];
  semCategoria: { sent: number; received: number; count: number; counterparties: number };
  period: Period;
  /** Total de saida das categorias de despesa, para o numero do topo. */
  despesas: number;
  receitas: number;
  accountOptions: AccountOption[];
  selectedAccountIds: string[];
  isMock: boolean;
}

/**
 * Centros de custo no periodo.
 *
 * Reaproveita a agregacao por contraparte — e a mesma classificacao, vista por
 * outro eixo. Transferencia entre contas proprias e movimentacao ficam de fora
 * pelo mesmo motivo da aba de contrapartes: o dinheiro mudou de bolso, nao foi
 * consumido.
 */
export async function loadCentrosDeCusto(
  period: Period,
  options: { accountIds?: string[] } = {},
): Promise<CentrosDeCustoData> {
  const accountIds = options.accountIds ?? [];

  if (useMock()) {
    return {
      categorias: [],
      noAno: [],
      semCategoria: { sent: 0, received: 0, count: 0, counterparties: 0 },
      period,
      despesas: 0,
      receitas: 0,
      accountOptions: [],
      selectedAccountIds: accountIds,
      isMock: true,
    };
  }

  // Uma leitura so cobrindo periodo e ano; os dois recortes saem dela em
  // memoria. Duas consultas ao banco para o mesmo intervalo seriam desperdicio.
  const ano = currentYearRange();
  const amplo = {
    from: period.from < ano.from ? period.from : ano.from,
    to: period.to > ano.to ? period.to : ano.to,
  };

  const conexao = db();
  const [{ todasAsContas, transacoes, registry, decisoes }, categorias, centros] =
    await Promise.all([
      carregar(amplo, accountIds),
      listCategorias(conexao),
      listCentrosDeCusto(conexao),
    ]);

  const rotulos = Object.fromEntries(
    (await listTransactionLabels(conexao)).map((r) => [
      r.transactionId,
      { categoryId: r.categoryId, costCenterId: r.costCenterId },
    ]),
  );

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const relevantes = conciliado.transacoes.filter(
    (t) => !t.counterparty?.self && classify(t) !== "transfer",
  );

  const noRecorte = (de: string, ate: string) =>
    cruzarCentrosDeCusto(
      categorias,
      centros,
      aggregateCounterparties(
        relevantes.filter((t) => {
          const dia = localDay(t.date);
          return dia >= de && dia <= ate;
        }),
        cadastro,
      ),
      rotulos,
    );

  const { categorias: totais, semCategoria } = noRecorte(period.from, period.to);

  return {
    categorias: totais,
    noAno: noRecorte(ano.from, ano.to).categorias,
    semCategoria,
    period,
    despesas: totalPorTipo(totais, "despesa").sent,
    receitas: totalPorTipo(totais, "receita").received,
    accountOptions: opcoes(todasAsContas),
    selectedAccountIds: accountIds,
    isMock: false,
  };
}

/** Taxonomia crua, para os formularios de cadastro. */
export async function loadTaxonomiaDeCentros() {
  if (useMock()) return { categorias: [], centros: [] };

  const conexao = db();
  const [categorias, centros] = await Promise.all([
    listCategorias(conexao),
    listCentrosDeCusto(conexao),
  ]);
  return { categorias, centros };
}

export interface CategoriaParaClassificar {
  id: string;
  name: string;
  hue: number;
  hint: string | null;
  /** Total ja classificado nesta categoria no dia e no mes. */
  noDia: number;
  noMes: number;
  lancamentosNoDia: number;
  centros: { id: string; name: string }[];
}

export interface LancamentoParaClassificar {
  id: string;
  /**
   * Dia local do lancamento, AAAA-MM-DD.
   *
   * A lista do dia nao precisa dele — ali todo mundo e do mesmo dia, e a hora
   * basta. O jogo do painel percorre um mes inteiro, e ali a hora sozinha nao
   * situa nada.
   */
  dia: string;
  hora: string;
  descricao: string;
  valor: number;
  conta: string;
  contraparte: string | null;
  /**
   * Chave que "aplicar a todos" grava. Contraparte quando a Pluggy mandou uma;
   * a descricao normalizada quando nao — que e o caso de toda compra no cartao.
   */
  contraparteKey: string | null;
  /** Como chamar o alvo da regra na tela: o apelido, o nome, ou a descricao. */
  alvoDaRegra: string | null;
  /**
   * Tudo o que se sabe sobre o lancamento, pronto para exibir.
   *
   * Existe para a hora de decidir a categoria: o cartao mostra o essencial, e
   * quando ele nao basta — "AMAZON BR" nao diz se foi livro ou fone — o resto
   * esta aqui. Montado no servidor porque e ele que tem os detalhes da Pluggy,
   * o documento e a categoria que ela atribuiu.
   */
  detalhes: { label: string; value: string }[];
  /**
   * O que foi comprado, quando um print de tela de pedido disse. A fatura traz
   * so "AMAZON BR"; isto e o que ela nao traz.
   */
  produtos: string[];
  /**
   * Se pede categoria. Entrada, movimentacao e lancamento automatico do banco
   * aparecem na lista — o dia e o dia inteiro — mas nao se classificam, entao
   * nao arrastam, nao contam como pendencia e nao ganham etiqueta.
   */
  classificavel: boolean;
  /** Quantos lancamentos a mesma contraparte tem no periodo carregado. */
  frequencia: number;
  /** Classificacao atual: do proprio lancamento, ou herdada da contraparte. */
  categoriaId: string | null;
  centroId: string | null;
  comentario: string | null;
  /** true quando veio da contraparte, nao de uma decisao sobre este lancamento. */
  herdada: boolean;
  /**
   * Categoria sugerida pelo ramo do estabelecimento (MCC do cartao).
   *
   * SUGESTAO, nunca atribuicao: o codigo descreve o lojista, nao a intencao da
   * compra. Serve para a bussola ja abrir com uma direcao acesa — o acerto
   * custa um enter, o erro custa uma seta.
   */
  sugestaoId: string | null;
  /**
   * "3/10" quando o lancamento e parcela de uma compra parcelada.
   *
   * Muda o que o numero na tela significa: dez parcelas sao um gasto, e nao
   * dez. Sem isto, classificar a mesma compra dez vezes parece trabalho novo a
   * cada mes.
   */
  parcela: string | null;
}

export interface ClassificacaoDoDia {
  dia: string;
  lancamentos: LancamentoParaClassificar[];
  categorias: CategoriaParaClassificar[];
}

/**
 * Chave pela qual um lancamento herda rotulo e generaliza regra.
 *
 * Contraparte quando a Pluggy mandou uma; a descricao normalizada quando nao,
 * que e o caso de toda compra no cartao. Fica aqui, fora das telas, porque as
 * duas que a usam — a lista do dia e a fita de situacao — precisam responder a
 * mesma coisa: divergir faria a bolinha dizer "pronto" num dia que a lista
 * mostra pendente.
 */
function chaveDeRegra(t: Transaction): string | null {
  const contraparte = chaveIdentificada(t.counterparty?.key);
  if (contraparte) return contraparte;

  const pelaDescricao = normalizeName(t.description ?? "");
  return pelaDescricao ? counterpartyFingerprint(pelaDescricao) : null;
}

/** Se o lancamento ja tem categoria, propria ou herdada da contraparte. */
/**
 * Indexa as regras por conta e plastico.
 *
 * A chave junta os dois porque `cardNumber` sao quatro digitos: dois bancos
 * diferentes podem ter cartoes terminados igual, e uma regra do Itau nao pode
 * alcancar um lancamento do Nubank.
 */
function indexarRegrasDeCartao(
  regras: { accountId: string; cardNumber: string; categoryId: string | null; costCenterId: string | null }[],
): Map<string, Atribuicao> {
  return new Map(
    regras.map((r) => [
      `${r.accountId}|${r.cardNumber}`,
      { categoryId: r.categoryId, costCenterId: r.costCenterId },
    ]),
  );
}

/** Indexa os rotulos de compra pela chave que ja vem cifrada do banco. */
function indexarRotulosDeCompra(
  rotulos: { purchaseKey: string; categoryId: string | null; costCenterId: string | null }[],
): Map<string, Atribuicao> {
  return new Map(
    rotulos.map((r) => [
      r.purchaseKey,
      { categoryId: r.categoryId, costCenterId: r.costCenterId },
    ]),
  );
}

/**
 * A classificacao da COMPRA a que esta parcela pertence.
 *
 * Uma compra parcelada e uma decisao so, tomada no mes em que ela aconteceu.
 * As parcelas seguintes — inclusive as de anos a frente, que a fatura ja
 * manda — herdam dela em vez de pedir classificacao de novo.
 */
function daCompra(
  t: Transaction,
  porCompra: Map<string, Atribuicao>,
): Atribuicao | null {
  const chave = chaveDaCompra(t.details, t.description);
  if (!chave) return null;
  return porCompra.get(purchaseFingerprint(chave)) ?? null;
}

/** A regra do cartao usado neste lancamento, se houver uma. */
function regraDoCartao(
  t: Transaction,
  porCartao: Map<string, Atribuicao>,
): Atribuicao | null {
  const numero = dadosDoCartao(t.details).numero;
  if (!numero) return null;
  return porCartao.get(`${t.accountId}|${numero}`) ?? null;
}

/** A atribuicao herdada da contraparte, ja resolvida para ids. */
function daContraparte(
  t: Transaction,
  cadastro: CounterpartyRegistry,
  categoriaPorNome: Map<string, string>,
): Atribuicao | null {
  const chave = chaveDeRegra(t);
  const herdada = chave ? cadastro[chave]?.category : null;
  if (!herdada) return null;

  return {
    categoryId: categoriaPorNome.get(normalizeName(herdada)) ?? null,
    costCenterId: null,
  };
}

function jaClassificado(
  t: Transaction,
  rotulos: Map<string, { categoryId: string | null; costCenterId: string | null }>,
  cadastro: CounterpartyRegistry,
  porCartao: Map<string, Atribuicao> = new Map(),
  porCompra: Map<string, Atribuicao> = new Map(),
): boolean {
  const chave = chaveDeRegra(t);

  return estaClassificado({
    proprio: rotulos.get(t.id) ?? null,
    compra: daCompra(t, porCompra),
    cartao: regraDoCartao(t, porCartao),
    // Aqui basta saber que existe heranca; resolver o id sairia caro para
    // responder a uma pergunta de sim ou nao.
    contraparte:
      chave && cadastro[chave]?.category
        ? { categoryId: "herdada", costCenterId: null }
        : null,
  });
}

export interface SituacaoDaFita {
  /** Por dia AAAA-MM-DD. */
  dias: Record<string, SituacaoDoDia>;
  /** Ate onde da para afirmar que o extrato esta completo. */
  fronteira: string | null;
}

/**
 * Situacao de cada dia da fita de datas.
 *
 * Uma consulta so para a janela inteira, e nao uma por dia: a fita mostra vinte
 * e tres dias, e vinte e tres viagens ao banco por render seria trocar uma
 * bolinha por uma tela lenta.
 */
export async function loadSituacaoDaFita(
  de: string,
  ate: string,
  options: { accountIds?: string[]; hoje?: string } = {},
): Promise<SituacaoDaFita> {
  const hoje = options.hoje ?? localDay(new Date());
  const accountIds = options.accountIds ?? [];

  if (useMock()) return { dias: {}, fronteira: hoje };

  const conexao = db();
  const [{ contas, transacoes, registry, decisoes }, rotulos, ultimoDia, regras, compras] =
    await Promise.all([
      carregar({ from: de, to: ate }, accountIds),
      listTransactionLabels(conexao),
      ultimoDiaPorConta(conexao, hoje),
      listRegrasDeCartao(conexao).catch(() => []),
      listRotulosDeCompra(conexao).catch(() => []),
    ]);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));
  // A fita tem de contar a pendencia com a MESMA regra da lista do dia: era a
  // divergencia entre as duas que fazia a bolinha dizer "pronto" num dia com
  // trabalho a fazer.
  const porCartao = indexarRegrasDeCartao(regras);
  const porCompra = indexarRotulosDeCompra(compras);

  const pendentes: Record<string, number> = {};
  for (const t of conciliado.transacoes) {
    if (!isUserInitiatedExpense(t)) continue;
    if (jaClassificado(t, porId, cadastro, porCartao, porCompra)) continue;

    const dia = localDay(t.date);
    pendentes[dia] = (pendentes[dia] ?? 0) + 1;
  }

  const fronteira = fronteiraDeDados(contas, ultimoDia, hoje);

  const dias: Record<string, SituacaoDoDia> = {};
  for (let dia = de; dia <= ate; dia = shiftDay(dia, 1)) {
    dias[dia] = situacaoDoDia(dia, fronteira, pendentes);
  }

  return { dias, fronteira };
}

/**
 * Despesas do periodo que ainda esperam categoria, para o modo jogo do painel.
 *
 * Irma de `loadClassificacaoDoDia`, com duas diferencas: a janela e o periodo
 * inteiro em vez de um dia, e so vem o que falta classificar — no painel a
 * lista nao e para conferir o mes, e para despachar o que sobrou.
 */
export async function loadPendentesDoPeriodo(
  period: Period,
  options: { accountIds?: string[] } = {},
): Promise<ClassificacaoDoDia> {
  const accountIds = options.accountIds ?? [];
  const conexao = db();

  const [
    { contas, transacoes, registry, decisoes },
    categorias,
    centros,
    rotulos,
    produtos,
    regras,
    compras,
  ] = await Promise.all([
    carregar(period, accountIds),
    listCategorias(conexao),
    listCentrosDeCusto(conexao),
    listTransactionLabels(conexao),
    listTransactionProducts(conexao).catch(() => []),
    listRegrasDeCartao(conexao).catch(() => []),
    listRotulosDeCompra(conexao).catch(() => []),
  ]);

  const porCartao = indexarRegrasDeCartao(regras);
  const porCompra = indexarRotulosDeCompra(compras);
  const idPorNomeDaCategoria = new Map(
    categorias.map((c) => [normalizeName(c.name), c.id] as const),
  );

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));

  const produtosPorTransacao = new Map<string, string[]>();
  for (const produto of produtos) {
    const lista = produtosPorTransacao.get(produto.transactionId) ?? [];
    lista.push(produto.name);
    produtosPorTransacao.set(produto.transactionId, lista);
  }

  const nomeDaConta: Record<string, string> = {};
  for (const conta of contas) nomeDaConta[conta.id] = conta.marketingName || conta.name;

  const frequencia = new Map<string, number>();
  for (const t of conciliado.transacoes) {
    const chave = chaveDeRegra(t);
    if (chave) frequencia.set(chave, (frequencia.get(chave) ?? 0) + 1);
  }

  const nomeDaParte = (t: Transaction): string | null => {
    const chave = chaveDeRegra(t);
    return (chave ? cadastro[chave]?.alias : null) || t.counterparty?.name || null;
  };

  /**
   * A categoria que o ramo do estabelecimento sugere.
   *
   * Resolvida por nome porque o mapa de MCC nao conhece os ids deste banco. Um
   * nome que nao exista no cadastro simplesmente nao sugere nada — melhor
   * silencio do que uma direcao que nunca acende.
   */
  const sugestaoDe = (t: Transaction): string | null => {
    const nome = categoriaDoMcc(dadosDoCartao(t.details).mcc);
    return nome ? (idPorNomeDaCategoria.get(normalizeName(nome)) ?? null) : null;
  };

  const pendentes = conciliado.transacoes
    .filter(
      (t) => isUserInitiatedExpense(t) && !jaClassificado(t, porId, cadastro, porCartao, porCompra),
    )
    .sort((a, b) => a.date.localeCompare(b.date));

  const lancamentos: LancamentoParaClassificar[] = pendentes.map((t) => {
    const rotulo = rotuloDoLancamento(t, nomeDaParte(t));
    const proprio = porId.get(t.id);

    return {
      id: t.id,
      dia: localDay(t.date),
      hora: localTime(t.date),
      descricao: rotulo,
      valor: t.amount,
      conta: nomeDaConta[t.accountId] ?? "",
      contraparte: nomeDaParte(t),
      contraparteKey: chaveDeRegra(t),
      alvoDaRegra: nomeDaParte(t) || t.description?.trim() || null,
      detalhes: [],
      produtos: produtosPorTransacao.get(t.id) ?? [],
      classificavel: true,
      frequencia: frequencia.get(chaveDeRegra(t) ?? "") ?? 1,
      categoriaId: null,
      centroId: null,
      comentario: proprio?.note ?? null,
      herdada: false,
      sugestaoId: sugestaoDe(t),
      parcela: rotuloDaParcela(dadosDoCartao(t.details)),
    };
  });

  return {
    dia: period.to,
    lancamentos,
    // Os totais por categoria nao entram: a bussola do jogo mostra nome e
    // icone, e somar o mes inteiro por categoria aqui seria trabalho para um
    // numero que ninguem le.
    categorias: categorias
      .filter((c) => c.kind === "despesa")
      .map((c) => ({
        id: c.id,
        name: c.name,
        hue: c.hue,
        hint: c.hint,
        noDia: 0,
        noMes: 0,
        lancamentosNoDia: 0,
        centros: centros
          .filter((centro) => centro.categoryId === c.id)
          .map((centro) => ({ id: centro.id, name: centro.name })),
      })),
  };
}

export interface DespesaPorConta {
  id: string;
  nome: string;
  connectorName: string;
  total: number;
  /** Passo de grafico da instituicao: mesma matiz da marca, claridade fixa. */
  cor: string;
}

/** Uma despesa dentro da arvore da categoria. So o que a linha mostra. */
export interface DespesaDaCategoria {
  id: string;
  dia: string;
  descricao: string;
  valor: number;
  conta: string;
}

export interface SubcategoriaDeDespesa {
  /** `null` no balde das despesas que estao na categoria sem centro de custo. */
  id: string | null;
  nome: string;
  total: number;
  lancamentos: DespesaDaCategoria[];
}

export interface DespesaPorCategoria {
  id: string | null;
  nome: string;
  hue: number;
  total: number;
  contagem: number;
  /**
   * A categoria aberta: os centros de custo e, dentro deles, os lancamentos.
   *
   * Vem tudo junto e nao sob demanda porque sao as mesmas transacoes que ja
   * foram lidas para somar a linha — buscar de novo a cada clique seria uma ida
   * ao servidor para dados que ja estao na memoria.
   */
  centros: SubcategoriaDeDespesa[];
}

export interface PainelDeDespesas {
  period: Period;
  contas: DespesaPorConta[];
  categorias: DespesaPorCategoria[];
  semCategoria: { total: number; contagem: number };
  /** Soma das despesas do periodo, com e sem categoria. */
  total: number;
  accountOptions: AccountOption[];
  selectedAccountIds: string[];
  isMock: boolean;
  /**
   * Conexoes que falharam na ultima sincronizacao.
   *
   * Viaja junto com os numeros de proposito: um total que ignora uma conta que
   * nao respondeu esta errado, e a tela precisa poder dizer isso ao lado dele.
   */
  failures: { itemId: string; message: string }[];
  syncedAt: Date | null;
}

/**
 * Despesas do periodo por conta e por categoria.
 *
 * Uma leitura so para as duas tabelas — por conta e por categoria — porque as
 * duas somam as MESMAS transacoes. Ler em dois lugares abriria a porta para
 * dois totais diferentes na mesma tela.
 */
export async function loadPainelDeDespesas(
  period: Period,
  options: { accountIds?: string[] } = {},
): Promise<PainelDeDespesas> {
  const accountIds = options.accountIds ?? [];
  const conexao = db();

  const [
    { contas, todasAsContas, transacoes, registry, decisoes, status },
    categorias,
    centros,
    rotulos,
    regras,
    compras,
  ] = await Promise.all([
    carregar(period, accountIds),
    listCategorias(conexao),
    listCentrosDeCusto(conexao),
    listTransactionLabels(conexao),
    listRegrasDeCartao(conexao).catch(() => []),
    listRotulosDeCompra(conexao).catch(() => []),
  ]);

  const porCartao = indexarRegrasDeCartao(regras);
  const porCompra = indexarRotulosDeCompra(compras);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));
  const centroPorId = new Map(centros.map((c) => [c.id, c]));
  const categoriaPorNome = new Map(categorias.map((c) => [normalizeName(c.name), c] as const));
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c] as const));

  const idPorNome = new Map([...categoriaPorNome].map(([nome, c]) => [nome, c.id] as const));

  /** A categoria que vale para o lancamento, na ordem de precedencia unica. */
  const categoriaDe = (t: Transaction): CategoriaRow | null => {
    const decidida = classificar({
      proprio: porId.get(t.id) ?? null,
      compra: daCompra(t, porCompra),
      cartao: regraDoCartao(t, porCartao),
      contraparte: daContraparte(t, cadastro, idPorNome),
    });

    // O centro carrega a categoria dele: quem escolheu um centro escolheu a
    // categoria junto, e ela vence o campo de categoria da mesma atribuicao.
    if (decidida.costCenterId) {
      const centro = centroPorId.get(decidida.costCenterId);
      if (centro) return categoriaPorId.get(centro.categoryId) ?? null;
    }

    return decidida.categoryId ? (categoriaPorId.get(decidida.categoryId) ?? null) : null;
  };

  const despesas = conciliado.transacoes.filter((t) => classify(t) === "expense");

  const nomeDaContraparte = (t: Transaction): string | null => {
    const chave = chaveDeRegra(t);
    return (chave ? cadastro[chave]?.alias : null) || t.counterparty?.name || null;
  };

  const nomeDaConta = new Map(contas.map((c) => [c.id, c.name] as const));
  const bancoDaConta = new Map(contas.map((c) => [c.id, c.connectorName] as const));

  const totalPorConta = new Map<string, number>();
  const totalPorCategoria = new Map<string, { total: number; contagem: number }>();
  /** categoria -> centro (ou "" para o balde sem centro) -> despesas. */
  const arvore = new Map<string, Map<string, DespesaDaCategoria[]>>();
  let semCategoria = { total: 0, contagem: 0 };
  let total = 0;

  /** O centro de custo do lancamento, proprio ou herdado da contraparte. */
  const centroDe = (t: Transaction): CentroDeCustoRow | null => {
    // Mesma ordem de precedencia da categoria: sem isto, uma despesa poderia
    // cair na categoria do cartao e na subcategoria da contraparte — duas
    // decisoes viradas numa terceira que ninguem tomou.
    const proprio = porId.get(t.id);
    if (proprio?.costCenterId) return centroPorId.get(proprio.costCenterId) ?? null;
    if (proprio?.categoryId) return null;

    const daSuaCompra = daCompra(t, porCompra);
    if (daSuaCompra) {
      return daSuaCompra.costCenterId ? (centroPorId.get(daSuaCompra.costCenterId) ?? null) : null;
    }

    const doCartao = regraDoCartao(t, porCartao);
    if (doCartao) {
      return doCartao.costCenterId ? (centroPorId.get(doCartao.costCenterId) ?? null) : null;
    }

    const chave = chaveDeRegra(t);
    const herdado = chave ? cadastro[chave] : null;
    if (!herdado?.subcategory) return null;

    const alvo = normalizeName(herdado.subcategory);
    return centros.find((c) => normalizeName(c.name) === alvo) ?? null;
  };

  for (const t of despesas) {
    const valor = -t.amount;
    total += valor;
    totalPorConta.set(t.accountId, (totalPorConta.get(t.accountId) ?? 0) + valor);

    const categoria = categoriaDe(t);
    if (!categoria) {
      semCategoria = { total: semCategoria.total + valor, contagem: semCategoria.contagem + 1 };
      continue;
    }

    const atual = totalPorCategoria.get(categoria.id) ?? { total: 0, contagem: 0 };
    totalPorCategoria.set(categoria.id, {
      total: atual.total + valor,
      contagem: atual.contagem + 1,
    });

    const centro = centroDe(t);
    // O centro so vale se for DESTA categoria: um centro herdado da contraparte
    // pode ter sido movido de categoria depois, e pendura-lo aqui somaria uma
    // subcategoria que nao pertence a linha.
    const chaveDoCentro = centro && centro.categoryId === categoria.id ? centro.id : "";

    const daCategoria = arvore.get(categoria.id) ?? new Map<string, DespesaDaCategoria[]>();
    const doCentro = daCategoria.get(chaveDoCentro) ?? [];
    doCentro.push({
      id: t.id,
      dia: localDay(t.date),
      descricao: rotuloDoLancamento(t, nomeDaContraparte(t)),
      valor,
      conta: nomeDaConta.get(t.accountId) ?? "",
    });
    daCategoria.set(chaveDoCentro, doCentro);
    arvore.set(categoria.id, daCategoria);
  }

  const porConta: DespesaPorConta[] = [...totalPorConta.entries()].map(([id, valor]) => {
    const banco = bancoDaConta.get(id) ?? "";
    return {
      id,
      nome: nomeDaConta.get(id) ?? banco,
      connectorName: banco,
      total: valor,
      cor: corDeGrafico(banco),
    };
  });

  return {
    period,
    contas: porConta,
    categorias: [...totalPorCategoria.entries()]
      .map(([id, dados]) => {
        const categoria = categoriaPorId.get(id);
        const daCategoria = arvore.get(id) ?? new Map<string, DespesaDaCategoria[]>();

        const centrosDaCategoria: SubcategoriaDeDespesa[] = [...daCategoria.entries()]
          .map(([centroId, lancamentos]) => ({
            id: centroId || null,
            nome: centroId
              ? (centroPorId.get(centroId)?.name ?? "Subcategoria")
              : "Sem subcategoria",
            total: lancamentos.reduce((soma, l) => soma + l.valor, 0),
            // Do maior para o menor: quem abre a categoria quer saber o que
            // pesou nela, e nao em que ordem as compras aconteceram.
            lancamentos: [...lancamentos].sort((a, b) => b.valor - a.valor),
          }))
          .sort((a, b) => b.total - a.total);

        return {
          id,
          nome: categoria?.name ?? "Categoria",
          hue: categoria?.hue ?? 250,
          ...dados,
          centros: centrosDaCategoria,
        };
      })
      .sort((a, b) => b.total - a.total),
    semCategoria,
    total,
    accountOptions: opcoes(todasAsContas),
    selectedAccountIds: accountIds,
    isMock: useMock(),
    failures: falhas(status),
    syncedAt: sincronizadoEm(status),
  };
}

/**
 * Dados da tela de classificar arrastando.
 *
 * Traz o dia inteiro e o mes corrente: os blocos mostram o que ja caiu neles no
 * dia e no mes, entao arrastar um cartao move um numero visivel na mesma tela —
 * sem isso a acao nao teria retorno.
 */
export async function loadClassificacaoDoDia(
  dia: string,
  options: { accountIds?: string[] } = {},
): Promise<ClassificacaoDoDia> {
  const accountIds = options.accountIds ?? [];
  const mes = { from: `${dia.slice(0, 7)}-01`, to: dia };
  const janela = { from: mes.from < dia ? mes.from : dia, to: dia };

  if (useMock()) return { dia, lancamentos: [], categorias: [] };

  const conexao = db();
  const [
    { contas, transacoes, registry, decisoes },
    categorias,
    centros,
    rotulos,
    produtos,
    regras,
    compras,
  ] = await Promise.all([
      carregar(janela, accountIds),
      listCategorias(conexao),
      listCentrosDeCusto(conexao),
      listTransactionLabels(conexao),
      // A tabela pode nao existir ainda (migracao 009 pendente). A tela do dia
      // nao pode cair por causa de um nome de produto: sem ela, os cartoes
      // ficam sem o produto e todo o resto continua funcionando.
      listTransactionProducts(conexao).catch(() => []),
      // Idem para a 014: sem a tabela, some a regra de cartao e o resto da
      // tela continua de pe.
      listRegrasDeCartao(conexao).catch(() => []),
      listRotulosDeCompra(conexao).catch(() => []),
    ]);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));
  const porCartao = indexarRegrasDeCartao(regras);
  const porCompra = indexarRotulosDeCompra(compras);

  // Produtos lidos de tela de pedido. Um pedido de tres itens cobrado de uma
  // vez tem tres produtos na mesma cobranca, entao a lista e por transacao.
  const produtosPorTransacao = new Map<string, string[]>();
  for (const produto of produtos) {
    const lista = produtosPorTransacao.get(produto.transactionId) ?? [];
    lista.push(produto.name);
    produtosPorTransacao.set(produto.transactionId, lista);
  }

  const nomeDaConta: Record<string, string> = {};
  for (const conta of contas) nomeDaConta[conta.id] = conta.marketingName || conta.name;

  const centroPorId = new Map(centros.map((c) => [c.id, c]));
  const categoriaPorRotulo = new Map(
    categorias.map((c) => [normalizeName(c.name), c.id] as const),
  );
  const centroPorRotulo = new Map(
    centros.map((c) => [`${c.categoryId}|${normalizeName(c.name)}`, c.id] as const),
  );

  // A chave e a mesma que a fita de situacao usa (`chaveDeRegra`, no topo do
  // arquivo): divergir faria a bolinha dizer "pronto" num dia que a lista
  // mostra pendente.
  const chaveDaRegra = chaveDeRegra;

  const frequencia = new Map<string, number>();
  for (const t of conciliado.transacoes) {
    const chave = chaveDaRegra(t);
    if (chave) frequencia.set(chave, (frequencia.get(chave) ?? 0) + 1);
  }

  // O dia inteiro, nao so o que se classifica: esta e a unica lista da tela.
  // Quem pede categoria e a saida iniciada pelo usuario; o resto vem junto
  // marcado como nao classificavel.
  const doDia = conciliado.transacoes
    .filter((t) => localDay(t.date) === dia)
    .sort((a, b) => a.date.localeCompare(b.date));

  const resolver = (t: Transaction) => {
    const proprio = porId.get(t.id);
    const comentario = proprio?.note ?? null;

    const chave = chaveDaRegra(t);
    const cadastroDaParte = chave ? cadastro[chave] : undefined;
    const daParte = cadastroDaParte?.category
      ? {
          categoryId: categoriaPorRotulo.get(normalizeName(cadastroDaParte.category)) ?? null,
          costCenterId: null,
        }
      : null;

    const decidida = classificar({
      proprio: proprio ?? null,
      compra: daCompra(t, porCompra),
      cartao: regraDoCartao(t, porCartao),
      contraparte: daParte,
    });

    if (decidida.origem === null) {
      return { categoriaId: null, centroId: null, comentario, herdada: false };
    }

    // A subcategoria da contraparte so entra quando foi ELA que classificou:
    // vinda junto de outra origem, seria um pedaco de uma decisao colado em
    // outra.
    if (decidida.origem === "contraparte") {
      const categoriaId = decidida.categoryId;
      const centroId =
        cadastroDaParte?.subcategory && categoriaId
          ? (centroPorRotulo.get(
              `${categoriaId}|${normalizeName(cadastroDaParte.subcategory)}`,
            ) ?? null)
          : null;

      return { categoriaId, centroId, comentario, herdada: true };
    }

    const centro = decidida.costCenterId ? centroPorId.get(decidida.costCenterId) : undefined;
    return {
      categoriaId: centro?.categoryId ?? decidida.categoryId,
      centroId: decidida.costCenterId,
      comentario,
      // Regra de cartao e categoria da compra tambem sao heranca: nao foram
      // decisoes sobre ESTE lancamento, e a etiqueta tem de dizer isso.
      herdada: decidida.origem !== "proprio",
    };
  };

  // Apelido primeiro: e como o usuario chama a contraparte. "PIX para Mae" diz
  // mais que "PIX para MARIA DA SILVA SANTOS", e o nome do extrato continua
  // guardado na contraparte, que e quem identifica e concilia.
  const nomeDaParte = (t: Transaction): string | null => {
    const chave = chaveIdentificada(t.counterparty?.key);
    return (chave ? cadastro[chave]?.alias : null) || t.counterparty?.name || null;
  };

  /** O que se sabe do lancamento, sem repetir o que o cartao ja mostra. */
  const detalhesDe = (t: Transaction, rotulo: string): { label: string; value: string }[] => {
    const linhas: { label: string; value: string }[] = [];
    const original = t.description?.trim();

    // So quando o rotulo trocou o texto: repetir a mesma frase duas vezes com
    // rotulos diferentes nao informa nada.
    if (original && original !== rotulo) {
      linhas.push({ label: "No extrato", value: original });
    }
    if (t.category) {
      linhas.push({ label: "Categoria da Pluggy", value: translateCategory(t.category) });
    }
    if (t.counterparty?.name) linhas.push({ label: "Contraparte", value: t.counterparty.name });
    if (t.counterparty?.document) {
      linhas.push({
        label: "Documento",
        value: maskDocument(t.counterparty.document, t.counterparty.documentType),
      });
    }

    const produtos = produtosPorTransacao.get(t.id) ?? [];
    if (produtos.length > 0) {
      linhas.push({ label: "Comprado", value: produtos.join(" · ") });
    }

    // Os detalhes que vieram da Pluggy por ultimo: meio de pagamento,
    // estabelecimento, dados do cartao. Sao os mais especificos.
    for (const detalhe of t.details ?? []) linhas.push(detalhe);

    return linhas;
  };

  /**
   * A categoria que o ramo do estabelecimento sugere.
   *
   * Resolvida por nome porque o mapa de MCC nao conhece os ids deste banco. Um
   * nome que nao exista no cadastro simplesmente nao sugere nada — melhor
   * silencio do que uma direcao que nunca acende.
   */
  const sugestaoDe = (t: Transaction): string | null => {
    const nome = categoriaDoMcc(dadosDoCartao(t.details).mcc);
    return nome ? (categoriaPorRotulo.get(normalizeName(nome)) ?? null) : null;
  };

  const lancamentos: LancamentoParaClassificar[] = doDia.map((t) => {
    const classificavel = isUserInitiatedExpense(t);
    const decidido = resolver(t);
    const rotulo = rotuloDoLancamento(t, nomeDaParte(t));

    return {
      id: t.id,
      dia: localDay(t.date),
      hora: localTime(t.date),
      descricao: rotulo,
      valor: t.amount,
      conta: nomeDaConta[t.accountId] ?? "",
      contraparte: nomeDaParte(t),
      contraparteKey: chaveDaRegra(t),
      alvoDaRegra: nomeDaParte(t) || t.description?.trim() || null,
      detalhes: detalhesDe(t, rotulo),
      produtos: produtosPorTransacao.get(t.id) ?? [],
      classificavel,
      frequencia: frequencia.get(chaveDaRegra(t) ?? "") ?? 1,
      ...decidido,
      sugestaoId: sugestaoDe(t),
      parcela: rotuloDaParcela(dadosDoCartao(t.details)),
      // Uma contraparte com categoria tambem manda dinheiro de volta: sem este
      // corte, um reembolso apareceria etiquetado como despesa dela.
      categoriaId: classificavel ? decidido.categoriaId : null,
      centroId: classificavel ? decidido.centroId : null,
    };
  });

  // Totais dos blocos: o que ja esta classificado naquela categoria, no dia e
  // no mes. Usa a mesma resolucao dos cartoes, entao os numeros batem com o que
  // a tela mostra.
  const totais = new Map<string, { dia: number; mes: number; contagem: number }>();
  for (const t of conciliado.transacoes) {
    if (!isUserInitiatedExpense(t)) continue;

    const { categoriaId } = resolver(t);
    if (!categoriaId) continue;

    const atual = totais.get(categoriaId) ?? { dia: 0, mes: 0, contagem: 0 };
    const valor = -t.amount;
    atual.mes += valor;
    if (localDay(t.date) === dia) {
      atual.dia += valor;
      atual.contagem += 1;
    }
    totais.set(categoriaId, atual);
  }

  return {
    dia,
    lancamentos,
    categorias: categorias
      .filter((c) => c.kind === "despesa")
      .map((c) => ({
        id: c.id,
        name: c.name,
        hue: c.hue,
        hint: c.hint,
        noDia: totais.get(c.id)?.dia ?? 0,
        noMes: totais.get(c.id)?.mes ?? 0,
        lancamentosNoDia: totais.get(c.id)?.contagem ?? 0,
        centros: centros
          .filter((centro) => centro.categoryId === c.id)
          .map((centro) => ({ id: centro.id, name: centro.name })),
      })),
  };
}

/**
 * A carteira de compromissos de capital.
 *
 * Nao depende de periodo nem de conta: um compromisso vive por anos e nao
 * pertence a um mes. Por isso e uma leitura propria, e nao mais um campo do
 * painel de despesas.
 */
export async function loadCompromissos(): Promise<CarteiraDeCompromissos> {
  const conexao = db();
  const [compromissos, chamadas] = await Promise.all([
    listCompromissos(conexao),
    listChamadas(conexao),
  ]);

  return montarCarteira(compromissos, chamadas);
}

export interface CartaoDaConta {
  numero: string;
  /** Quantos lancamentos sairam dele na janela lida. */
  lancamentos: number;
  /** Soma do que saiu, positiva. */
  gasto: number;
  /** Data do lancamento mais recente, para reconhecer cartao fora de uso. */
  ultimoUso: string | null;
  categoriaId: string | null;
  centroId: string | null;
  apelido: string | null;
}

export interface ContaCadastrada {
  id: string;
  nome: string;
  connectorName: string;
  tipo: string;
  subtipo: string | null;
  /** Vazio em conta que nao e cartao. */
  cartoes: CartaoDaConta[];
}

export interface CadastroDeContas {
  contas: ContaCadastrada[];
  categorias: { id: string; name: string; hue: number }[];
  centros: { id: string; categoryId: string; name: string }[];
  /** Ate onde a leitura olhou, para a tela poder dizer de que periodo fala. */
  desde: string;
  /**
   * A tabela de regras ainda nao existe neste banco.
   *
   * Ler com tolerancia e escrever sem ela e a pior combinacao: a tela abre
   * inteira, o botao Salvar parece disponivel, e o clique estoura em erro de
   * servidor sem dizer nada. Quando falta a migracao, a tela precisa DIZER
   * isso e nao oferecer o que nao vai funcionar.
   */
  migracaoPendente: boolean;
}

/**
 * As contas e, dentro das de cartao, os plasticos que aparecem nos lancamentos.
 *
 * Os cartoes nao vem de um cadastro: o Open Finance nao cria conta para o
 * adicional e o banco nao manda o nome de quem usou. O que existe e o
 * `cardNumber` no bloco do cartao de cada lancamento — entao a lista de
 * plasticos e DESCOBERTA lendo o historico, e nao consultada.
 *
 * Por isso a janela e larga: um cartao pouco usado precisa de meses para
 * aparecer, e um que nao aparece nao pode receber regra.
 */
export async function loadCadastroDeContas(
  options: { meses?: number; hoje?: string } = {},
): Promise<CadastroDeContas> {
  const hoje = options.hoje ?? localDay(new Date());
  const desde = shiftMonth(hoje.slice(0, 7), -(options.meses ?? 12)) + "-01";

  const conexao = db();

  // A falha nao e engolida: e guardada. A tela precisa saber a diferenca entre
  // "nao ha regra nenhuma" e "nao da para gravar regra".
  let migracaoPendente = false;

  const [contas, categorias, centros, regras, transacoes] = await Promise.all([
    listAccounts(conexao),
    listCategorias(conexao),
    listCentrosDeCusto(conexao),
    listRegrasDeCartao(conexao).catch(() => {
      migracaoPendente = true;
      return [];
    }),
    listTransactions(conexao, { from: desde, to: hoje }),
  ]);

  const regraPorChave = new Map(regras.map((r) => [`${r.accountId}|${r.cardNumber}`, r] as const));

  /** conta -> cartao -> o que se sabe dele pelos lancamentos. */
  const vistos = new Map<string, Map<string, { n: number; gasto: number; ultimo: string }>>();

  for (const linha of transacoes) {
    const numero = dadosDoCartao(linha.details ?? undefined).numero;
    if (!numero) continue;

    const daConta = vistos.get(linha.accountId) ?? new Map();
    const atual = daConta.get(numero) ?? { n: 0, gasto: 0, ultimo: "" };
    const dia = linha.localDay;

    daConta.set(numero, {
      n: atual.n + 1,
      // So saida: um estorno nao "gastou", e somar o sinal cru faria o cartao
      // do mes com muita devolucao parecer pouco usado.
      gasto: atual.gasto + (linha.amount < 0 ? -linha.amount : 0),
      ultimo: dia > atual.ultimo ? dia : atual.ultimo,
    });
    vistos.set(linha.accountId, daConta);
  }

  return {
    desde,
    migracaoPendente,
    categorias: categorias.map((c) => ({ id: c.id, name: c.name, hue: c.hue })),
    centros: centros.map((c) => ({ id: c.id, categoryId: c.categoryId, name: c.name })),
    contas: contas
      .map((conta) => {
        const daConta = vistos.get(conta.id) ?? new Map();

        return {
          id: conta.id,
          nome: conta.name || conta.connectorName,
          connectorName: conta.connectorName,
          tipo: conta.type,
          subtipo: conta.subtype ?? null,
          cartoes: [...daConta.entries()]
            .map(([numero, dados]) => {
              const regra = regraPorChave.get(`${conta.id}|${numero}`);
              return {
                numero,
                lancamentos: dados.n,
                gasto: dados.gasto,
                ultimoUso: dados.ultimo || null,
                categoriaId: regra?.categoryId ?? null,
                centroId: regra?.costCenterId ?? null,
                apelido: regra?.label ?? null,
              };
            })
            // Do mais usado para o menos: e a ordem em que se reconhece um
            // cartao, e o pouco usado costuma ser o substituido.
            .sort((a, b) => b.lancamentos - a.lancamentos),
        };
      })
      .sort((a, b) => a.connectorName.localeCompare(b.connectorName, "pt-BR")),
  };
}
