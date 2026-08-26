import type { Transaction } from "@/lib/pluggy/types";
import { expenseAmount, incomeAmount } from "./money";

export interface CategoryTotal {
  category: string;
  total: number;
  count: number;
  /** Fracao do total de gastos do periodo, de 0 a 1. */
  share: number;
}

export interface MonthlyFlow {
  /** Formato AAAA-MM. */
  month: string;
  income: number;
  expenses: number;
  net: number;
}

const SEM_CATEGORIA = "Sem categoria";

/**
 * Gastos agrupados por categoria, do maior para o menor.
 * Entradas sao ignoradas: misturar salario com gastos torna o grafico inutil.
 */
export function totalsByCategory(transactions: Transaction[]): CategoryTotal[] {
  const buckets = new Map<string, { total: number; count: number }>();

  for (const transaction of transactions) {
    const amount = expenseAmount(transaction);
    if (amount === 0) continue;

    const category = transaction.category?.trim() || SEM_CATEGORIA;
    const bucket = buckets.get(category) ?? { total: 0, count: 0 };
    bucket.total += amount;
    bucket.count += 1;
    buckets.set(category, bucket);
  }

  const grandTotal = [...buckets.values()].reduce((sum, bucket) => sum + bucket.total, 0);

  return [...buckets.entries()]
    .map(([category, bucket]) => ({
      category,
      total: bucket.total,
      count: bucket.count,
      share: grandTotal > 0 ? bucket.total / grandTotal : 0,
    }))
    .sort((a, b) => b.total - a.total);
}

/** Entradas e saidas por mes, do mes mais antigo para o mais recente. */
export function monthlyFlow(transactions: Transaction[]): MonthlyFlow[] {
  const buckets = new Map<string, { income: number; expenses: number }>();

  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;

    const bucket = buckets.get(month) ?? { income: 0, expenses: 0 };
    bucket.income += incomeAmount(transaction);
    bucket.expenses += expenseAmount(transaction);
    buckets.set(month, bucket);
  }

  return [...buckets.entries()]
    .map(([month, bucket]) => ({
      month,
      income: bucket.income,
      expenses: bucket.expenses,
      net: bucket.income - bucket.expenses,
    }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

export function totalExpenses(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => total + expenseAmount(transaction), 0);
}

export function totalIncome(transactions: Transaction[]): number {
  return transactions.reduce((total, transaction) => total + incomeAmount(transaction), 0);
}

/** Primeiro dia do mes corrente e hoje, no formato AAAA-MM-DD que a API espera. */
export function currentMonthRange(today: Date = new Date()): { from: string; to: string } {
  const year = today.getUTCFullYear();
  const month = String(today.getUTCMonth() + 1).padStart(2, "0");
  return {
    from: `${year}-${month}-01`,
    to: today.toISOString().slice(0, 10),
  };
}
