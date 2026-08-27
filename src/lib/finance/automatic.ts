import type { Transaction } from "@/lib/pluggy/types";
import { classify } from "./categories";

/**
 * Lancamentos gerados pelo proprio banco, sem acao do usuario: IOF, rendimento
 * de saldo remunerado, juros. Na linha do tempo do dia eles atrapalham, porque
 * a pergunta ali e "o que eu fiz neste dia" — e esses lancamentos nao sao
 * resposta para ela.
 *
 * A lista e proposital e conservadora: esconder um gasto de verdade e pior que
 * mostrar um lancamento automatico a mais. Para incluir outro padrao, basta
 * acrescentar aqui.
 */
const PADROES_AUTOMATICOS: RegExp[] = [
  /\biof\b/,
  /rendimento/,
  /saldo\s*remunerado/,
  /remunerac[ao]/,
  /\bjuros\b/,
];

function normalizar(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function isBankGenerated(transaction: Transaction): boolean {
  const texto = normalizar(`${transaction.description} ${transaction.descriptionRaw ?? ""}`);
  return PADROES_AUTOMATICOS.some((padrao) => padrao.test(texto));
}

/**
 * Despesas iniciadas pelo usuario: exclui entradas, lancamentos automaticos do
 * banco e movimentacoes (aplicacao, transferencia entre contas proprias), que
 * ja tem tratamento proprio no resto do app.
 */
export function isUserInitiatedExpense(transaction: Transaction): boolean {
  if (transaction.amount >= 0) return false;
  if (isBankGenerated(transaction)) return false;
  return classify(transaction) === "expense";
}
