import "server-only";

import * as pluggy from "@/lib/pluggy/client";
import { mockAccounts, mockItems, mockTransactions } from "@/lib/pluggy/mock";
import type { AccountWithConnector, Item, Transaction } from "@/lib/pluggy/types";
import { listItemIds } from "@/lib/store";
import { netWorth, sumBy } from "./money";
import {
  currentMonthRange,
  totalExpenses,
  totalIncome,
  totalsByCategory,
  type CategoryTotal,
} from "./summary";

export interface DashboardData {
  accounts: AccountWithConnector[];
  transactions: Transaction[];
  categories: CategoryTotal[];
  netWorth: number;
  cashBalance: number;
  creditBalance: number;
  income: number;
  expenses: number;
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
        const item: Item = await pluggy.getItem(itemId);
        const itemAccounts = await pluggy.getAccounts(itemId);

        for (const account of itemAccounts) {
          accounts.push({
            ...account,
            connectorName: item.connector.name,
            connectorImageUrl: item.connector.imageUrl,
            connectorPrimaryColor: item.connector.primaryColor,
          });
        }

        const perAccount = await Promise.all(
          itemAccounts.map((account) => pluggy.getTransactions(account.id, period)),
        );
        transactions.push(...perAccount.flat());
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
    period,
    failures,
    isMock,
  };
}
