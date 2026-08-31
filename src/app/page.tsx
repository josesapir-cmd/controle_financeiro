import { AccountsList } from "@/components/AccountsList";
import { CategoryBars } from "@/components/CategoryBars";
import { StatTile } from "@/components/StatTile";
import { TransactionsTable } from "@/components/TransactionsTable";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { SairButton } from "@/components/SairButton";
import { AccountFilter } from "@/components/AccountFilter";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { formatBRL } from "@/lib/finance/money";
import { loadDashboard, type DashboardData } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const sincronizacao = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatarPeriodo(period: { from: string; to: string }): string {
  const formatar = (iso: string) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString("pt-BR", { day: "2-digit", month: "long" });
  return `${formatar(period.from)} a ${formatar(period.to)}`;
}

function Setup({ mensagem }: { mensagem: string }) {
  return (
    <main className="page">
      <h1>Controle Financeiro</h1>
      <section className="card" style={{ marginTop: 24 }}>
        <h2>Configuracao pendente</h2>
        <p className="empty">
          {mensagem}
          <br />
          <br />
          Copie <code>.env.example</code> para <code>.env.local</code> e preencha{" "}
          <code>PLUGGY_CLIENT_ID</code> e <code>PLUGGY_CLIENT_SECRET</code> com as credenciais do
          Meu Pluggy. Depois cadastre o <code>itemId</code> de cada conexao em{" "}
          <code>PLUGGY_ITEM_IDS</code>, separando por virgula.
          <br />
          <br />
          Com as credenciais no lugar, cadastre as conexoes em{" "}
          <Link href="/conexoes">Conexoes</Link>
          <SairButton /> colando a URL do Meu Pluggy.
          <br />
          <br />
          Para ver a interface sem tocar na API, use <code>PLUGGY_MOCK=true</code>.
        </p>
      </section>
    </main>
  );
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ contas?: string | string[] }>;
}) {
  await requireSession();

  const accountIds = parseAccountIds((await searchParams).contas);
  let dados: DashboardData;

  try {
    dados = await loadDashboard(new Date(), { accountIds });
  } catch (error) {
    return <Setup mensagem={error instanceof Error ? error.message : "Erro ao carregar dados."} />;
  }

  if (dados.accounts.length === 0 && dados.failures.length === 0) {
    return <Setup mensagem="Nenhuma conexao cadastrada." />;
  }

  const saldo = dados.income - dados.expenses;
  const contasQuery = accountQuery(dados.selectedAccountIds);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Controle Financeiro</h1>
        <span className="period">
          {dados.syncedAt ? `Atualizado em ${sincronizacao.format(dados.syncedAt)} · ` : ""}
          {formatarPeriodo(dados.period)}
          <SairButton />
        </span>
      </div>

      <Nav atual="/" contasQuery={contasQuery} />

      <div className="filtros">
        <AccountFilter
          options={dados.accountOptions}
          selected={dados.selectedAccountIds}
          action="/"
        />
      </div>

      {dados.isMock ? (
        <p className="banner">
          <strong>Dados ficticios.</strong> A variavel <code>PLUGGY_MOCK</code> esta ativa — nada
          aqui vem da sua conta.
        </p>
      ) : null}

      {dados.syncedAt ? null : (
        <p className="banner">
          <strong>Ainda nao sincronizado.</strong> As telas leem do banco, que sera populado na
          primeira sincronizacao.
        </p>
      )}

      {dados.failures.length > 0 ? (
        <p className="banner">
          <strong>
            {dados.failures.length}{" "}
            {dados.failures.length === 1 ? "conexao falhou" : "conexoes falharam"}.
          </strong>{" "}
          O restante do painel segue valido, mas incompleto: {dados.failures[0].message}
        </p>
      ) : null}

      <div className="tiles">
        <StatTile
          label="Patrimonio liquido"
          value={dados.netWorth}
          note="Saldos em conta menos faturas em aberto"
          tone={dados.netWorth < 0 ? "negative" : "neutral"}
        />
        <StatTile label="Entradas no periodo" value={dados.income} tone="positive" />
        <StatTile label="Saidas no periodo" value={dados.expenses} tone="negative" />
        <StatTile
          label="Resultado do periodo"
          value={saldo}
          note={saldo < 0 ? "Voce gastou mais do que recebeu" : "Sobrou no periodo"}
          tone={saldo < 0 ? "negative" : "positive"}
        />
      </div>

      {dados.transfers > 0 ? (
        <p className="banner">
          <strong>{formatBRL(dados.transfers)} em movimentacoes</strong> no periodo — aplicacoes,
          transferencias entre contas suas e pagamento de fatura. Nao entram nos gastos porque o
          dinheiro mudou de lugar, nao foi consumido.
        </p>
      ) : null}

      <section>
        <h2>Contas</h2>
        <AccountsList accounts={dados.accounts} />
      </section>

      <section>
        <h2>Gastos por categoria</h2>
        <div className="card">
          <CategoryBars categories={dados.categories} />
        </div>
      </section>

      <section>
        <h2>Lancamentos</h2>
        <div className="card">
          <TransactionsTable transactions={dados.transactions} />
        </div>
      </section>
    </main>
  );
}
