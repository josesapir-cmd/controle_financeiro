import { formatBRL, maskAccountNumber } from "@/lib/finance/money";
import type { AccountWithConnector } from "@/lib/pluggy/types";

const NOMES_DE_TIPO: Record<string, string> = {
  CHECKING_ACCOUNT: "Conta corrente",
  SAVINGS_ACCOUNT: "Poupanca",
  CREDIT_CARD: "Cartao de credito",
};

export function AccountsList({ accounts }: { accounts: AccountWithConnector[] }) {
  if (accounts.length === 0) {
    return <p className="empty">Nenhuma conta encontrada nas conexoes cadastradas.</p>;
  }

  return (
    <div className="accounts">
      {accounts.map((account) => {
        const ehCartao = account.type === "CREDIT";
        const tipo = (account.subtype && NOMES_DE_TIPO[account.subtype]) || account.type;

        return (
          <div className="card" key={account.id}>
            <div className="account-name">{account.name}</div>
            <div className="account-meta">
              {account.connectorName} · {tipo} {maskAccountNumber(account.number)}
            </div>
            {/* Fatura de cartao e divida: mostramos com sinal negativo para que a
                soma visual bata com o patrimonio liquido do topo. */}
            <div className={`account-balance ${ehCartao && account.balance > 0 ? "negative" : ""}`}>
              {formatBRL(ehCartao ? -account.balance : account.balance)}
            </div>
            {ehCartao ? (
              <div className="tile-note">
                {account.creditData?.balanceDueDate
                  ? `Vence em ${new Date(account.creditData.balanceDueDate).toLocaleDateString("pt-BR")}`
                  : "Fatura em aberto"}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
