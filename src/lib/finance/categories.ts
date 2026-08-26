import type { Transaction } from "@/lib/pluggy/types";

/**
 * A Pluggy devolve categorias em ingles ("Investments", "Same person transfer").
 * Traduzimos para exibicao e, mais importante, separamos o que e gasto de fato
 * do que e apenas movimentacao de dinheiro entre bolsos do proprio usuario.
 *
 * O mapa e parcial por natureza — a taxonomia da Pluggy e maior do que o que ja
 * apareceu nos dados. Categoria desconhecida mantem o nome original e conta como
 * gasto, que e o comportamento seguro: aparece no painel em vez de sumir.
 */

export type Classification = "expense" | "income" | "transfer";

/**
 * Movimentacoes que nao sao consumo: aplicar em CDB, transferir entre contas
 * proprias, pagar a fatura do cartao. Somar isso aos gastos distorce o painel —
 * uma aplicacao de R$ 45.000 sozinha esmagaria todas as outras categorias.
 */
const MOVIMENTACOES = new Set([
  "investments",
  "same person transfer",
  "transfers",
  "transfer",
  "credit card payment",
  "credit card bill payment",
  "loans",
  "loan",
]);

const TRADUCOES: Record<string, string> = {
  "investments": "Investimentos",
  "same person transfer": "Transferencia entre contas proprias",
  "transfers": "Transferencias",
  "transfer": "Transferencia",
  "credit card payment": "Pagamento de fatura",
  "income": "Renda",
  "salary": "Salario",
  "food and drinks": "Alimentacao",
  "groceries": "Mercado",
  "supermarket": "Mercado",
  "shopping": "Compras",
  "transport": "Transporte",
  "transportation": "Transporte",
  "gas station": "Combustivel",
  "travel": "Viagem",
  "housing": "Moradia",
  "rent": "Aluguel",
  "utilities": "Contas de casa",
  "telecommunications": "Telecomunicacoes",
  "internet": "Internet",
  "health": "Saude",
  "pharmacy": "Farmacia",
  "education": "Educacao",
  "leisure": "Lazer",
  "entertainment": "Entretenimento",
  "services": "Servicos",
  "taxes": "Impostos",
  "insurance": "Seguros",
  "bank fees": "Tarifas bancarias",
  "withdrawal": "Saque",
  "pets": "Pets",
  "donations": "Doacoes",
  "gifts": "Presentes",
  "legal obligations": "Obrigacoes legais",
  "other": "Outros",
};

const SEM_CATEGORIA = "Sem categoria";

function normalizar(category: string | null | undefined): string {
  return (category ?? "").trim().toLowerCase();
}

/** Nome da categoria em portugues, com recuo para o original quando desconhecido. */
export function translateCategory(category: string | null | undefined): string {
  const chave = normalizar(category);
  if (!chave) return SEM_CATEGORIA;
  return TRADUCOES[chave] ?? (category as string).trim();
}

export function isTransfer(transaction: Transaction): boolean {
  return MOVIMENTACOES.has(normalizar(transaction.category));
}

export function classify(transaction: Transaction): Classification {
  if (isTransfer(transaction)) return "transfer";
  return transaction.amount < 0 ? "expense" : "income";
}
