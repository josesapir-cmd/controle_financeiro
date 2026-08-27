import { NAO_IDENTIFICADA } from "@/lib/finance/counterparties";
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
  /** Hora local do lancamento, para a linha do tempo do dia. */
  hora?: string;
  /** Contraparte ficticia: nome e documento, como viriam de paymentData. */
  parte?: { nome: string; doc: string };
  /** Reproduz o caso real em que payer vem nulo e a contraparte se perde. */
  semContraparte?: boolean;
}

const seeds: Seed[] = [
  { day: 5, description: "Salario", amount: 8400, category: "Salary", hora: "08:12", accountId: CHECKING_ID },
  { day: 5, description: "Aluguel", amount: -2600, category: "Housing", hora: "09:35", accountId: CHECKING_ID },
  { day: 6, description: "Condominio", amount: -680, category: "Housing", hora: "11:04", accountId: CHECKING_ID },
  { day: 7, description: "Supermercado", amount: -412.9, category: "Groceries", hora: "12:47", accountId: CARD_ID },
  { day: 9, description: "Farmacia", amount: -87.4, category: "Health", hora: "13:20", accountId: CARD_ID },
  { day: 10, description: "Restaurante", amount: -132.5, category: "Food and drinks", hora: "15:08", accountId: CARD_ID },
  { day: 11, description: "Transporte por app", amount: -46.2, category: "Transport", hora: "16:41", accountId: CARD_ID },
  { day: 12, description: "Streaming", amount: -55.9, category: "Leisure", hora: "18:03", accountId: CARD_ID },
  { day: 14, description: "Supermercado", amount: -298.15, category: "Groceries", hora: "19:22", accountId: CARD_ID },
  { day: 15, description: "Energia eletrica", amount: -214.77, category: "Housing", hora: "20:15", accountId: CHECKING_ID },
  { day: 17, description: "Livraria", amount: -119.9, category: "Leisure", hora: "21:48", accountId: CARD_ID },
  { day: 18, description: "Transporte por app", amount: -38.7, category: "Transport", hora: "07:55", accountId: CARD_ID },
  { day: 19, description: "Academia", amount: -149, category: "Health", hora: "10:30", accountId: CHECKING_ID },
  { day: 20, description: "Restaurante", amount: -96.4, category: "Food and drinks", hora: "14:12", accountId: CARD_ID },
  { day: 21, description: "Freelance", amount: 1500, category: "Income", hora: "17:36", accountId: CHECKING_ID },
  { day: 22, description: "Internet", amount: -129.9, category: "Housing", hora: "22:05", accountId: CHECKING_ID },
  { day: 24, description: "Supermercado", amount: -356.8, category: "Groceries", hora: "06:40", accountId: CARD_ID },
  { day: 25, description: "Cinema", amount: -72, category: "Leisure", hora: "23:10", accountId: CARD_ID },
  // Movimentacoes: saem da conta mas nao sao consumo. Presentes no mock porque
  // e exatamente o caso que distorce o painel se for tratado como gasto.
  { day: 26, description: "Aplicacao CDB", amount: -45000, category: "Investments", hora: "08:12", accountId: CHECKING_ID },
  { day: 23, description: "Pix enviado", amount: -2000, category: "Same person transfer", hora: "09:35", accountId: CHECKING_ID },
  // Contrapartes: pagamentos recorrentes, recebimentos e um caso sem dados.
  { day: 5, description: "Pix enviado - Maria Locadora", amount: -2600, category: "Housing", hora: "11:04", accountId: CHECKING_ID, parte: { nome: "Maria Locadora", doc: "12345678901" } },
  { day: 8, description: "Pix enviado - Joao Diarista", amount: -320, category: "Services", hora: "12:47", accountId: CHECKING_ID, parte: { nome: "Joao Diarista", doc: "98765432100" } },
  { day: 16, description: "Pix enviado - Joao Diarista", amount: -320, category: "Services", hora: "13:20", accountId: CHECKING_ID, parte: { nome: "Joao Diarista", doc: "98765432100" } },
  { day: 21, description: "Pix recebido - Cliente Alfa Ltda", amount: 1500, category: "Income", hora: "15:08", accountId: CHECKING_ID, parte: { nome: "Cliente Alfa Ltda", doc: "12345678000199" } },
  { day: 13, description: "Transferencia recebida", amount: 450, category: "Income", hora: "16:41", accountId: CHECKING_ID, semContraparte: true },
];

/**
 * Converte hora local de Brasilia (UTC-3) para o instante UTC correspondente,
 * que e o formato em que a Pluggy devolve as datas.
 */
function utcFromLocal(year: number, month: string, day: number, hora: string): string {
  const [h, m] = hora.split(":").map(Number);
  const instante = Date.UTC(year, Number(month) - 1, day, h + 3, m, 0);
  return new Date(instante).toISOString();
}

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
      // O mock guarda hora local; somamos 3h para gravar em UTC, como a Pluggy faz.
      date: utcFromLocal(year, month, seed.day, seed.hora ?? "12:00"),
      category: seed.category,
      type: seed.amount < 0 ? ("DEBIT" as const) : ("CREDIT" as const),
      status: "POSTED",
      counterparty: seed.semContraparte
        ? { key: NAO_IDENTIFICADA, self: false }
        : seed.parte
          ? {
              key: seed.parte.doc,
              name: seed.parte.nome,
              document: seed.parte.doc,
              documentType: seed.parte.doc.length === 14 ? "CNPJ" : "CPF",
              self: false,
            }
          : null,
    }));
}
