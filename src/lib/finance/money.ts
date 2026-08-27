import type { Account, Transaction } from "@/lib/pluggy/types";

/**
 * Convencao de sinal da Pluggy: valores negativos sao saidas, positivos sao
 * entradas. Centralizamos a interpretacao aqui para que uma eventual diferenca
 * por tipo de conta seja corrigida em um lugar so, e nao espalhada em somas.
 */

/**
 * A Pluggy usa convencoes de sinal opostas conforme o tipo de conta:
 *
 * - BANK: saida negativa, entrada positiva.
 * - CREDIT: a compra vem POSITIVA, porque aumenta a fatura; estorno e pagamento
 *   da fatura vem negativos.
 *
 * Verificado com dados reais: uma compra de mercado no cartao chegou como
 * +17,90 no mesmo extrato em que uma compra no debito chegou como -12,00.
 *
 * Normalizamos tudo para a convencao do app — negativo e dinheiro saindo — na
 * fronteira do servico, para que nenhum calculo adiante precise saber de que
 * tipo de conta veio a transacao.
 */
export function normalizeAmount(amount: number, accountType: Account["type"]): number {
  return accountType === "CREDIT" ? -amount : amount;
}

export function isExpense(transaction: Transaction): boolean {
  return transaction.amount < 0;
}

export function isIncome(transaction: Transaction): boolean {
  return transaction.amount > 0;
}

/** Valor da saida como numero positivo. Zero para entradas. */
export function expenseAmount(transaction: Transaction): number {
  return transaction.amount < 0 ? -transaction.amount : 0;
}

/** Valor da entrada como numero positivo. Zero para saidas. */
export function incomeAmount(transaction: Transaction): number {
  return transaction.amount > 0 ? transaction.amount : 0;
}

/**
 * Patrimonio liquido: saldos em conta menos faturas de cartao em aberto.
 * A Pluggy devolve a fatura como numero positivo no campo balance, entao somar
 * tudo cegamente inflaria o patrimonio pelo valor da divida.
 */
export function netWorth(accounts: Account[]): number {
  return accounts.reduce((total, account) => {
    return account.type === "CREDIT" ? total - account.balance : total + account.balance;
  }, 0);
}

export function sumBy(accounts: Account[], type: Account["type"]): number {
  return accounts
    .filter((account) => account.type === type)
    .reduce((total, account) => total + account.balance, 0);
}

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export function formatBRL(value: number): string {
  // -0 formata como "-R$ 0,00", o que confunde. Normalizamos para 0.
  return brl.format(Object.is(value, -0) ? 0 : value);
}

/** Mostra apenas os ultimos digitos. Numero de conta e dado sensivel. */
export function maskAccountNumber(value: string | undefined | null): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return `•••• ${digits}`;
  return `•••• ${digits.slice(-4)}`;
}
