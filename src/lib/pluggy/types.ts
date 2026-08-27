/**
 * Modelo de dados da Pluggy.
 *
 * Os campos aqui foram conferidos contra respostas reais da API (conector Inter,
 * conta corrente e cartao de credito). Campos que a API pode omitir dependendo do
 * conector sao opcionais: um conector que devolve menos dados nao deve quebrar a
 * aplicacao inteira.
 */

export type ItemStatus =
  | "CREATING"
  | "UPDATING"
  | "UPDATED"
  | "LOGIN_ERROR"
  | "WAITING_USER_INPUT"
  | "OUTDATED"
  | "ERROR";

export interface Connector {
  id: number;
  name: string;
  imageUrl?: string;
  primaryColor?: string;
  institutionUrl?: string;
  country?: string;
  type?: string;
  products?: string[];
  health?: { status?: string; stage?: string | null };
}

export interface Item {
  id: string;
  connector: Connector;
  status: ItemStatus;
  executionStatus?: string;
  createdAt: string;
  updatedAt: string;
  lastUpdatedAt?: string | null;
}

export type AccountType = "BANK" | "CREDIT";

export interface Account {
  id: string;
  itemId: string;
  type: AccountType;
  subtype?: string;
  name: string;
  marketingName?: string | null;
  number?: string;
  /**
   * Conta corrente: saldo disponivel.
   * Cartao de credito: valor da fatura em aberto, como numero positivo.
   * Por isso o patrimonio liquido subtrai as contas CREDIT — ver netWorth().
   */
  balance: number;
  currencyCode: string;
  /** PII. Nunca exibir inteiro nem gravar em log. */
  taxNumber?: string | null;
  /** PII. */
  owner?: string | null;
  bankData?: {
    transferNumber?: string | null;
    closingBalance?: number | null;
    automaticallyInvestedBalance?: number | null;
    overdraftContractedLimit?: number | null;
    overdraftUsedLimit?: number | null;
  } | null;
  creditData?: {
    level?: string | null;
    brand?: string | null;
    creditLimit?: number | null;
    availableCreditLimit?: number | null;
    balanceCloseDate?: string | null;
    balanceDueDate?: string | null;
    minimumPayment?: number | null;
  } | null;
}

import type { Counterparty } from "@/lib/finance/counterparties";
import type { Detail } from "@/lib/finance/details";

export type TransactionType = "DEBIT" | "CREDIT";

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  descriptionRaw?: string | null;
  /**
   * Valor como a Pluggy devolve: negativo para saida, positivo para entrada.
   * Use os helpers de finance/money.ts em vez de somar direto.
   */
  amount: number;
  currencyCode: string;
  date: string;
  category?: string | null;
  categoryId?: string | null;
  type?: TransactionType;
  status?: string;
  /**
   * Contraparte extraida de paymentData na fronteira do servico. O bloco
   * original nao trafega: ele carrega o CPF do proprio usuario e varios campos
   * que a aplicacao nao usa.
   */
  counterparty?: Counterparty | null;
  /**
   * Detalhes prontos para exibicao (meio de pagamento, estabelecimento, dados
   * do cartao, identificadores). Extraidos na fronteira do servico, ja sem o
   * documento do proprio usuario.
   */
  details?: Detail[];
}

export interface Paginated<T> {
  results: T[];
  page?: number;
  total?: number;
  totalPages?: number;
}

/** Conta enriquecida com o banco de origem, para exibicao. */
export interface AccountWithConnector extends Account {
  connectorName: string;
  connectorImageUrl?: string;
  connectorPrimaryColor?: string;
}
