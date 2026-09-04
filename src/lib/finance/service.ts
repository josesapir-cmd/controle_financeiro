import "server-only";

import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  counterpartyFingerprint,
  listAccounts,
  listChamadas,
  listCompromissos,
  listCategorias,
  listCentrosDeCusto,
  listCounterpartyLinks,
  listTransactionLabels,
  listTransactionProducts,
  ultimoDiaPorConta,
  type CategoriaRow,
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
import { currentMonthRange, currentYearRange, localDay, localTime, shiftDay } from "./dates";
import { netWorth, normalizeAmount, sumBy } from "./money";
import { rotuloDoLancamento } from "./rotulo";
import { fronteiraDeDados, situacaoDoDia, type SituacaoDoDia } from "./situacao";
import { corDeGrafico } from "./cores-de-conta";
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
function jaClassificado(
  t: Transaction,
  rotulos: Map<string, { categoryId: string | null; costCenterId: string | null }>,
  cadastro: CounterpartyRegistry,
): boolean {
  const proprio = rotulos.get(t.id);
  if (proprio && (proprio.categoryId || proprio.costCenterId)) return true;

  const chave = chaveDeRegra(t);
  return Boolean(chave && cadastro[chave]?.category);
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
  const [{ contas, transacoes, registry, decisoes }, rotulos, ultimoDia] = await Promise.all([
    carregar({ from: de, to: ate }, accountIds),
    listTransactionLabels(conexao),
    ultimoDiaPorConta(conexao, hoje),
  ]);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));

  const pendentes: Record<string, number> = {};
  for (const t of conciliado.transacoes) {
    if (!isUserInitiatedExpense(t)) continue;
    if (jaClassificado(t, porId, cadastro)) continue;

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

  const [{ contas, transacoes, registry, decisoes }, categorias, centros, rotulos, produtos] =
    await Promise.all([
      carregar(period, accountIds),
      listCategorias(conexao),
      listCentrosDeCusto(conexao),
      listTransactionLabels(conexao),
      listTransactionProducts(conexao).catch(() => []),
    ]);

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

  const pendentes = conciliado.transacoes
    .filter((t) => isUserInitiatedExpense(t) && !jaClassificado(t, porId, cadastro))
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

export interface DespesaPorCategoria {
  id: string | null;
  nome: string;
  hue: number;
  total: number;
  contagem: number;
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
  ] = await Promise.all([
      carregar(period, accountIds),
      listCategorias(conexao),
      listCentrosDeCusto(conexao),
      listTransactionLabels(conexao),
    ]);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));
  const centroPorId = new Map(centros.map((c) => [c.id, c]));
  const categoriaPorNome = new Map(categorias.map((c) => [normalizeName(c.name), c] as const));
  const categoriaPorId = new Map(categorias.map((c) => [c.id, c] as const));

  /** A categoria que vale para o lancamento: a propria, senao a da contraparte. */
  const categoriaDe = (t: Transaction): CategoriaRow | null => {
    const proprio = porId.get(t.id);
    if (proprio?.costCenterId) {
      const centro = centroPorId.get(proprio.costCenterId);
      if (centro) return categoriaPorId.get(centro.categoryId) ?? null;
    }
    if (proprio?.categoryId) return categoriaPorId.get(proprio.categoryId) ?? null;

    const chave = chaveDeRegra(t);
    const herdada = chave ? cadastro[chave]?.category : null;
    return herdada ? (categoriaPorNome.get(normalizeName(herdada)) ?? null) : null;
  };

  const despesas = conciliado.transacoes.filter((t) => classify(t) === "expense");

  const nomeDaConta = new Map(contas.map((c) => [c.id, c.name] as const));
  const bancoDaConta = new Map(contas.map((c) => [c.id, c.connectorName] as const));

  const totalPorConta = new Map<string, number>();
  const totalPorCategoria = new Map<string, { total: number; contagem: number }>();
  let semCategoria = { total: 0, contagem: 0 };
  let total = 0;

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
        return {
          id,
          nome: categoria?.name ?? "Categoria",
          hue: categoria?.hue ?? 250,
          ...dados,
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
  const [{ contas, transacoes, registry, decisoes }, categorias, centros, rotulos, produtos] =
    await Promise.all([
      carregar(janela, accountIds),
      listCategorias(conexao),
      listCentrosDeCusto(conexao),
      listTransactionLabels(conexao),
      // A tabela pode nao existir ainda (migracao 009 pendente). A tela do dia
      // nao pode cair por causa de um nome de produto: sem ela, os cartoes
      // ficam sem o produto e todo o resto continua funcionando.
      listTransactionProducts(conexao).catch(() => []),
    ]);

  const conciliado = conciliar(transacoes, decisoes);
  const cadastro = herdarRotulos(registry, conciliado.sugestoes, decisoes);
  const porId = new Map(rotulos.map((r) => [r.transactionId, r]));

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
    if (proprio && (proprio.categoryId || proprio.costCenterId)) {
      const centro = proprio.costCenterId ? centroPorId.get(proprio.costCenterId) : undefined;
      return {
        categoriaId: centro?.categoryId ?? proprio.categoryId,
        centroId: proprio.costCenterId,
        comentario: proprio.note,
        herdada: false,
      };
    }

    const chave = chaveDaRegra(t);
    const cadastroDaParte = chave ? cadastro[chave] : undefined;
    if (!cadastroDaParte?.category) {
      return {
        categoriaId: null,
        centroId: null,
        comentario: proprio?.note ?? null,
        herdada: false,
      };
    }

    const categoriaId = categoriaPorRotulo.get(normalizeName(cadastroDaParte.category)) ?? null;
    const centroId = cadastroDaParte.subcategory && categoriaId
      ? centroPorRotulo.get(`${categoriaId}|${normalizeName(cadastroDaParte.subcategory)}`) ?? null
      : null;

    return { categoriaId, centroId, comentario: proprio?.note ?? null, herdada: true };
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
