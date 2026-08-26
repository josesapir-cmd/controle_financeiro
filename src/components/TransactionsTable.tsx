import { translateCategory } from "@/lib/finance/categories";
import { formatBRL } from "@/lib/finance/money";
import type { Transaction } from "@/lib/pluggy/types";

const data = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

/**
 * Tabela e tambem a visao acessivel dos dados que as barras resumem: quem nao
 * distingue as cores, ou usa leitor de tela, le os mesmos numeros aqui.
 */
export function TransactionsTable({ transactions }: { transactions: Transaction[] }) {
  if (transactions.length === 0) {
    return <p className="empty">Nenhum lancamento no periodo.</p>;
  }

  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th scope="col">Data</th>
            <th scope="col">Descricao</th>
            <th scope="col">Categoria</th>
            <th scope="col" style={{ textAlign: "right", paddingRight: 0 }}>
              Valor
            </th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((transaction) => (
            <tr key={transaction.id}>
              <td>{data.format(new Date(transaction.date))}</td>
              <td className="description">{transaction.description}</td>
              <td>{transaction.category ? translateCategory(transaction.category) : "—"}</td>
              <td className={`amount ${transaction.amount < 0 ? "negative" : "positive"}`}>
                {formatBRL(transaction.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
