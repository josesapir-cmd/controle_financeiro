import type { Account, Item, Transaction } from "./types";

/**
 * Dados ficticios com a mesma forma das respostas reais da Pluggy, para
 * desenvolver a interface sem chamar a API nem expor dados bancarios de verdade.
 * Ativado por PLUGGY_MOCK=true.
 */

const ITEM_ID = "11111111-1111-4111-8111-111111111111";
const CHECKING_ID = "22222222-2222-4222-8222-222222222222";
const CARD_ID = "33333333-3333-4333-8333-333333333333";

export const mockItems: Item[] = [
  {
    id: ITEM_ID,
    status: "UPDATED",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-26T09:00:00.000Z",
    connector: {
      id: 823,
      name: "Banco Exemplo",
      primaryColor: "fb6910",
      country: "BR",
      type: "PERSONAL_BANK",
      products: ["ACCOUNTS", "TRANSACTIONS"],
      health: { status: "ONLINE", stage: null },
    },
  },
];

export const mockAccounts: Account[] = [
  {
    id: CHECKING_ID,
    itemId: ITEM_ID,
    type: "BANK",
    subtype: "CHECKING_ACCOUNT",
    name: "Conta Corrente",
    number: "00000000-0",
    balance: 3153.01,
    currencyCode: "BRL",
    bankData: { closingBalance: 3153.01, overdraftContractedLimit: 0 },
    creditData: null,
  },
  {
    id: CARD_ID,
    itemId: ITEM_ID,
    type: "CREDIT",
    subtype: "CREDIT_CARD",
    name: "Cartao Exemplo",
    number: "0000",
    balance: 1847.32,
    currencyCode: "BRL",
    creditData: {
      brand: "MASTERCARD",
      creditLimit: 12000,
      availableCreditLimit: 10152.68,
      balanceDueDate: "2026-09-10",
      minimumPayment: 184.73,
    },
  },
];

interface Seed {
  day: number;
  description: string;
  amount: number;
  category: string;
  accountId: string;
}

const seeds: Seed[] = [
  { day: 5, description: "Salario", amount: 8400, category: "Salary", accountId: CHECKING_ID },
  { day: 5, description: "Aluguel", amount: -2600, category: "Housing", accountId: CHECKING_ID },
  { day: 6, description: "Condominio", amount: -680, category: "Housing", accountId: CHECKING_ID },
  { day: 7, description: "Supermercado", amount: -412.9, category: "Groceries", accountId: CARD_ID },
  { day: 9, description: "Farmacia", amount: -87.4, category: "Health", accountId: CARD_ID },
  { day: 10, description: "Restaurante", amount: -132.5, category: "Food and drinks", accountId: CARD_ID },
  { day: 11, description: "Transporte por app", amount: -46.2, category: "Transport", accountId: CARD_ID },
  { day: 12, description: "Streaming", amount: -55.9, category: "Leisure", accountId: CARD_ID },
  { day: 14, description: "Supermercado", amount: -298.15, category: "Groceries", accountId: CARD_ID },
  { day: 15, description: "Energia eletrica", amount: -214.77, category: "Housing", accountId: CHECKING_ID },
  { day: 17, description: "Livraria", amount: -119.9, category: "Leisure", accountId: CARD_ID },
  { day: 18, description: "Transporte por app", amount: -38.7, category: "Transport", accountId: CARD_ID },
  { day: 19, description: "Academia", amount: -149, category: "Health", accountId: CHECKING_ID },
  { day: 20, description: "Restaurante", amount: -96.4, category: "Food and drinks", accountId: CARD_ID },
  { day: 21, description: "Freelance", amount: 1500, category: "Income", accountId: CHECKING_ID },
  { day: 22, description: "Internet", amount: -129.9, category: "Housing", accountId: CHECKING_ID },
  { day: 24, description: "Supermercado", amount: -356.8, category: "Groceries", accountId: CARD_ID },
  { day: 25, description: "Cinema", amount: -72, category: "Leisure", accountId: CARD_ID },
  // Movimentacoes: saem da conta mas nao sao consumo. Presentes no mock porque
  // e exatamente o caso que distorce o painel se for tratado como gasto.
  { day: 26, description: "Aplicacao CDB", amount: -45000, category: "Investments", accountId: CHECKING_ID },
  { day: 23, description: "Pix enviado", amount: -2000, category: "Same person transfer", accountId: CHECKING_ID },
];

/** Gera o extrato ficticio dentro do mes de referencia informado. */
export function mockTransactions(accountId: string, reference = new Date()): Transaction[] {
  const year = reference.getUTCFullYear();
  const month = String(reference.getUTCMonth() + 1).padStart(2, "0");

  return seeds
    .filter((seed) => seed.accountId === accountId)
    .map((seed, index) => ({
      id: `mock-${accountId}-${index}`,
      accountId,
      description: seed.description,
      amount: seed.amount,
      currencyCode: "BRL",
      date: `${year}-${month}-${String(seed.day).padStart(2, "0")}T12:00:00.000Z`,
      category: seed.category,
      type: seed.amount < 0 ? ("DEBIT" as const) : ("CREDIT" as const),
      status: "POSTED",
    }));
}
