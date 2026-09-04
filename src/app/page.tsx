import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { AccountFilter } from "@/components/AccountFilter";
import { DespesasPorCategoria } from "@/components/DespesasPorCategoria";
import { DespesasPorConta } from "@/components/DespesasPorConta";
import { Nav } from "@/components/Nav";
import { SairButton } from "@/components/SairButton";
import { SpinnerDeMeses } from "@/components/SpinnerDeMeses";
import { ClassificarNoPeriodo } from "./ClassificarNoPeriodo";
import { accountQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { currentMonthRange } from "@/lib/finance/dates";
import {
  loadPainelDeDespesas,
  loadPendentesDoPeriodo,
  type PainelDeDespesas,
} from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const sincronizacao = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function lerPeriodo(params: { from?: string; to?: string }) {
  const padrao = currentMonthRange();
  const from = params.from && DATA_ISO.test(params.from) ? params.from : padrao.from;
  const to = params.to && DATA_ISO.test(params.to) ? params.to : padrao.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

/**
 * As tres leituras do mes.
 *
 * Receitas e Investimentos ficam desabilitadas de proposito e nao escondidas:
 * a barra e o mapa da tela, e um mapa que so mostra a estrada ja percorrida
 * nao diz para onde isto vai. `aria-disabled` num botao inerte, e nao um link
 * morto, para quem navega por teclado nao cair num destino que nao existe.
 */
function Abas() {
  return (
    <div className="painel-abas" role="tablist" aria-label="Visoes do painel">
      <button type="button" role="tab" aria-selected className="painel-aba ativa">
        Despesas
      </button>
      <button type="button" role="tab" aria-selected={false} className="painel-aba" disabled>
        Receitas
        <span className="painel-aba-nota">em breve</span>
      </button>
      <button type="button" role="tab" aria-selected={false} className="painel-aba" disabled>
        Investimentos
        <span className="painel-aba-nota">em breve</span>
      </button>
    </div>
  );
}

function Setup({ mensagem }: { mensagem: string }) {
  return (
    <main className="page solo">
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
  searchParams: Promise<{ from?: string; to?: string; contas?: string | string[] }>;
}) {
  await requireSession();

  const params = await searchParams;
  const periodo = lerPeriodo(params);
  const accountIds = parseAccountIds(params.contas);

  let dados: PainelDeDespesas;
  let pendentes: Awaited<ReturnType<typeof loadPendentesDoPeriodo>>;

  try {
    // As duas leituras juntas: a fila do jogo e os totais somam as mesmas
    // transacoes, e o "ainda sem categoria" do topo tem que bater com o que o
    // modal abre.
    [dados, pendentes] = await Promise.all([
      loadPainelDeDespesas(periodo, { accountIds }),
      loadPendentesDoPeriodo(periodo, { accountIds }),
    ]);
  } catch (error) {
    return <Setup mensagem={error instanceof Error ? error.message : "Erro ao carregar dados."} />;
  }

  if (dados.accountOptions.length === 0 && dados.failures.length === 0) {
    return <Setup mensagem="Nenhuma conexao cadastrada." />;
  }

  const contasQuery = accountQuery(dados.selectedAccountIds);
  const aClassificar = pendentes.lancamentos.filter((l) => l.classificavel && !l.categoriaId);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Painel</h1>
        <span className="period">
          {dados.syncedAt ? `Atualizado em ${sincronizacao.format(dados.syncedAt)}` : "Sem sincronizacao"}
          <SairButton />
        </span>
      </div>

      <Nav atual="/" contasQuery={contasQuery} />

      {/* Fora dos outros controles: no celular a fita gruda no alto da tela, e
          um `sticky` so anda dentro do proprio pai. */}
      <div className="spinner-barra">
        <SpinnerDeMeses from={periodo.from} to={periodo.to} queryExtra={contasQuery} rota="/" />
      </div>

      <Abas />

      <div className="period-controls">
        <AccountFilter
          options={dados.accountOptions}
          selected={dados.selectedAccountIds}
          action="/"
          hidden={{ from: periodo.from, to: periodo.to }}
        />
      </div>

      {dados.isMock ? (
        <p className="banner">
          <strong>Dados ficticios.</strong> A variavel <code>PLUGGY_MOCK</code> esta ativa — nada
          aqui vem da sua conta.
        </p>
      ) : null}

      {dados.failures.length > 0 ? (
        <p className="banner">
          <strong>
            {dados.failures.length}{" "}
            {dados.failures.length === 1 ? "conexao falhou" : "conexoes falharam"}.
          </strong>{" "}
          Os totais abaixo seguem validos, mas incompletos: {dados.failures[0].message}
        </p>
      ) : null}

      {/* Antes dos numeros, e nao depois: o total sem categoria e o que decide
          se da para confiar na distribuicao que vem em seguida. */}
      <ClassificarNoPeriodo
        lancamentos={aClassificar}
        categorias={pendentes.categorias}
        total={dados.semCategoria.total}
        contagem={dados.semCategoria.contagem}
        totalDoPeriodo={dados.total}
      />

      {dados.total === 0 ? (
        <p className="empty">Nenhuma despesa neste periodo.</p>
      ) : (
        <>
          <DespesasPorConta contas={dados.contas} total={dados.total} />
          <DespesasPorCategoria categorias={dados.categorias} total={dados.total} />
        </>
      )}
    </main>
  );
}
