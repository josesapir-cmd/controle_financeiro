/**
 * Modelo de dados da Pluggy.
 *
 * Os campos marcados como opcionais sao os que a API pode omitir dependendo do
 * conector e do tipo de conta. Preferimos campos opcionais a valores obrigatorios
 * porque um conector que devolve menos dados nao deve quebrar a aplicacao inteira.
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
  /** Saldo em conta. Para cartao de credito, e a fatura em aberto. */
  balance: number;
  currencyCode: string;
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

export type TransactionType = "DEBIT" | "CREDIT";

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  descriptionRaw?: string | null;
  /** Valor bruto como a Pluggy devolve. Use normalizeAmount() antes de somar. */
  amount: number;
  currencyCode: string;
  date: string;
  category?: string | null;
  categoryId?: string | null;
  type?: TransactionType;
  status?: string;
}

export interface Paginated<T> {
  results: T[];
  page?: number;
  total?: number;
  totalPages?: number;
}

/** Uma conta junto com o item (banco) a que pertence, para exibicao. */
export interface AccountWithItem extends Account {
  connectorName: string;
  connectorImageUrl?: string;
}
