import "server-only";

import * as pluggy from "@/lib/pluggy/client";
import { mockAccounts, mockItems, mockTransactions } from "@/lib/pluggy/mock";
import type { AccountWithConnector, Item, Transaction } from "@/lib/pluggy/types";
import { listItemIds, listItems, type StoredItem } from "@/lib/store";
import { netWorth, sumBy } from "./money";
import {
  currentMonthRange,
  totalExpenses,
  totalIncome,
  totalTransfers,
  totalsByCategory,
  type CategoryTotal,
} from "./summary";

/**
 * A v2 devolve, em cada transacao, um bloco paymentData que carrega o CPF do
 * pagador e dados do recebedor. Nada disso e usado pelo painel, e trafegar PII
 * alem do necessario so cria superficie de vazamento — em log, em cache, ou na
 * serializacao para o navegador. Copiamos apenas os campos que a interface usa.
 */
function sanitize(transaction: Transaction): Transaction {
  return {
    id: transaction.id,
    accountId: transaction.accountId,
    description: transaction.description,
    amount: transaction.amount,
    currencyCode: transaction.currencyCode,
    date: transaction.date,
    category: transaction.category ?? null,
    categoryId: transaction.categoryId ?? null,
    type: transaction.type,
    status: transaction.status,
  };
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
  /** Movimentacoes que nao sao consumo: aplicacoes, transferencias proprias. */
  transfers: number;
  period: { from: string; to: string };
  /** Conexoes que falharam, para avisar sem derrubar o resto do painel. */
  failures: { itemId: string; message: string }[];
  isMock: boolean;
}

function useMock(): boolean {
  return process.env.PLUGGY_MOCK === "true";
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : "Erro desconhecido";
}

async function loadReal(period: { from: string; to: string }) {
  const itemIds = await listItemIds();
  const accounts: AccountWithConnector[] = [];
  const transactions: Transaction[] = [];
  const failures: { itemId: string; message: string }[] = [];

  // Uma conexao com problema (banco fora do ar, credencial expirada) nao deve
  // esconder as demais, entao cada item e isolado em seu proprio try.
  await Promise.all(
    itemIds.map(async (itemId) => {
      try {
        // O item so fornece o nome do banco para exibicao. Algumas conexoes
        // respondem 404 em GET /items/{id} mesmo tendo contas acessiveis por
        // /accounts?itemId=, entao a falha aqui nao pode derrubar a conexao
        // inteira: seria descartar dados bons por causa de um rotulo.
        const item = await pluggy.getItem(itemId).catch(() => undefined);
        const itemAccounts = await pluggy.getAccounts(itemId);

        for (const account of itemAccounts) {
          accounts.push({
            ...account,
            connectorName: item?.connector.name ?? account.marketingName ?? account.name,
            connectorImageUrl: item?.connector.imageUrl,
            connectorPrimaryColor: item?.connector.primaryColor,
          });
        }

        const perAccount = await Promise.all(
          itemAccounts.map((account) => pluggy.getTransactions(account.id, period)),
        );
        transactions.push(...perAccount.flat().map(sanitize));
      } catch (error) {
        failures.push({ itemId, message: describe(error) });
      }
    }),
  );

  return { accounts, transactions, failures };
}

function loadMock(reference: Date) {
  const accounts: AccountWithConnector[] = mockAccounts.map((account) => ({
    ...account,
    connectorName: mockItems[0].connector.name,
    connectorPrimaryColor: mockItems[0].connector.primaryColor,
  }));

  const transactions = accounts.flatMap((account) => mockTransactions(account.id, reference));

  return { accounts, transactions, failures: [] };
}

export async function loadDashboard(reference: Date = new Date()): Promise<DashboardData> {
  const period = currentMonthRange(reference);
  const isMock = useMock();

  const { accounts, transactions, failures } = isMock
    ? loadMock(reference)
    : await loadReal(period);

  transactions.sort((a, b) => b.date.localeCompare(a.date));

  return {
    accounts,
    transactions,
    categories: totalsByCategory(transactions),
    netWorth: netWorth(accounts),
    cashBalance: sumBy(accounts, "BANK"),
    creditBalance: sumBy(accounts, "CREDIT"),
    income: totalIncome(transactions),
    expenses: totalExpenses(transactions),
    transfers: totalTransfers(transactions),
    period,
    failures,
    isMock,
  };
}

export interface ConnectionRow {
  stored: StoredItem;
  item?: Item;
  /** Contas encontradas quando o item nao pode ser consultado. */
  contas?: number;
  erro?: string;
}

/**
 * Conexoes cadastradas com o estado de cada uma. Vive aqui, e nao na pagina,
 * para que a decisao entre dados reais e ficticios continue em um lugar so.
 */
export async function loadConnections(): Promise<ConnectionRow[]> {
  const armazenados = await listItems();

  if (useMock()) {
    return armazenados.map((stored) => ({
      stored,
      item: { ...mockItems[0], id: stored.id },
    }));
  }

  // Cada conexao e consultada isoladamente: uma credencial expirada em um banco
  // nao pode impedir a tela de mostrar e gerenciar as demais.
  return Promise.all(
    armazenados.map(async (stored): Promise<ConnectionRow> => {
      const item = await pluggy.getItem(stored.id).catch(() => undefined);
      if (item) return { stored, item };

      // Sem o item, ainda vale checar as contas: ha conexoes que respondem 404
      // em /items/{id} e mesmo assim entregam contas.
      //
      // Cuidado ao ler o resultado: /accounts?itemId= devolve 200 com lista
      // vazia tambem para itemId inexistente (verificado com um UUID inventado),
      // entao lista vazia NAO significa "conexao sem contas". Nesse caso a
      // unica evidencia confiavel e o 404, e a mensagem precisa dizer isso em
      // vez de sugerir um problema de consentimento que pode nao existir.
      try {
        const accounts = await pluggy.getAccounts(stored.id);
        if (accounts.length > 0) return { stored, contas: accounts.length };

        return {
          stored,
          erro:
            "Este itemId nao pertence as suas credenciais. Confirme no Meu Pluggy que a conexao " +
            "terminou de sincronizar e que voce copiou o link da propria conexao.",
        };
      } catch (error) {
        return { stored, erro: describe(error) };
      }
    }),
  );
}
