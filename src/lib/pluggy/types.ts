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
  /**
   * 'pluggy' para o que vem do Open Finance, 'manual' para conta cadastrada
   * aqui — hoje so o saldo compartilhado do Nubank. Conta manual nao tem saldo
   * apurado, entao fica fora do patrimonio (ver finance/service.ts).
   */
  origin?: "pluggy" | "manual";
}

/**
 * Posicao de investimento como a Pluggy devolve.
 *
 * Fotografia do que se tem hoje, e nao lancamento: nao tem data de competencia
 * e nao entra em soma de gasto. Os campos variam muito por tipo — renda fixa
 * tem taxa e vencimento, fundo nao — entao quase tudo e opcional.
 */
export interface Investment {
  id: string;
  itemId?: string;
  type: string;
  subtype?: string | null;
  name?: string | null;
  issuer?: string | null;
  /**
   * LIQUIDO de imposto. Confere ao centavo: `amount - taxes - taxes2`.
   *
   * O nome engana — nao e o saldo da posicao, e o que sobraria resgatando.
   */
  balance?: number | null;
  /**
   * Valor de mercado BRUTO. Confere com `quantity * value`, ao centavo.
   *
   * O nome tambem engana: parece o aportado, e e o de hoje. O aportado e
   * `amountOriginal`.
   */
  amount?: number | null;
  /** O que foi aportado na compra. */
  amountOriginal?: number | null;
  /** Vem nulo em toda posicao observada; o lucro sai de amount - amountOriginal. */
  amountProfit?: number | null;
  /** Imposto retido e o que mais a instituicao descontar. */
  taxes?: number | null;
  taxes2?: number | null;
  /** Quantos titulos ou cotas. */
  quantity?: number | null;
  /** Preco unitario. E a marcacao de hoje, sem ninguem digitar nada. */
  value?: number | null;
  /**
   * A taxa CONTRATADA no lote — o que se recebe levando ao vencimento.
   *
   * E ela que a coluna Taxa quer. `annualRate` vem nulo em renda fixa, que e
   * por que a coluna mostrava traco justamente no Tesouro.
   */
  fixedAnnualRate?: number | null;
  /** Percentual do indexador: 100 no Tesouro, 102 num CDB, 70 num CRI. */
  rate?: number | null;
  annualRate?: number | null;
  dueDate?: string | null;
  currencyCode?: string | null;
  status?: string | null;
  institution?: { name?: string | null } | null;
}
