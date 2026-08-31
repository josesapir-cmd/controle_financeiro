import "server-only";

import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  listAccounts,
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
import { classify } from "./categories";
import {
  aggregateCounterparties,
  type CounterpartyRegistry,
  type CounterpartyTotal,
} from "./counterparties";
import { currentMonthRange, localDay } from "./dates";
import { netWorth, normalizeAmount, sumBy } from "./money";
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

    return { contas: selecionadas, todasAsContas: todas, transacoes, registry: {}, status: [] };
  }

  const conexao = db();
  const [contasBrutas, linhas, rotulos, estado] = await Promise.all([
    listAccounts(conexao),
    listTransactions(conexao, { ...periodo, accountIds }),
    listLabels(conexao),
    syncStatus(conexao),
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
    };
  }

  return { contas, todasAsContas, transacoes: linhas.map(paraTransacao), registry, status: estado };
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
}

export async function loadCounterparties(
  period: Period,
  options: { includeInternal?: boolean; accountIds?: string[] } = {},
): Promise<CounterpartiesData> {
  const accountIds = options.accountIds ?? [];
  const { contas, todasAsContas, transacoes, registry, status } = await carregar(
    period,
    accountIds,
  );

  // Transferencia entre contas proprias e aplicacao nao sao contraparte: o
  // dinheiro mudou de bolso dentro do proprio patrimonio.
  const relevantes = options.includeInternal
    ? transacoes
    : transacoes.filter((t) => !t.counterparty?.self && classify(t) !== "transfer");

  const counterparties = aggregateCounterparties(relevantes, registry);

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
 * Categorias e subcategorias ja usadas, para sugerir em vez de exigir digitacao
 * — e, com isso, evitar que a mesma categoria vire tres variacoes de grafia.
 */
export async function loadTaxonomy(): Promise<{ categories: string[]; subcategories: string[] }> {
  if (useMock()) return { categories: [], subcategories: [] };

  const rotulos = await listLabels(db());
  const categorias = new Set<string>();
  const subcategorias = new Set<string>();

  for (const rotulo of rotulos) {
    if (rotulo.category) categorias.add(rotulo.category);
    if (rotulo.subcategory) subcategorias.add(rotulo.subcategory);
  }

  const ordenar = (a: string, b: string) => a.localeCompare(b, "pt-BR");
  return {
    categories: [...categorias].sort(ordenar),
    subcategories: [...subcategorias].sort(ordenar),
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
