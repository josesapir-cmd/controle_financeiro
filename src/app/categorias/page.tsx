import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { AccountFilter } from "@/components/AccountFilter";
import { Nav } from "@/components/Nav";
import { TreemapCategorias } from "@/components/TreemapCategorias";
import { Indice } from "./Indice";
import { SpinnerDeMeses } from "@/components/SpinnerDeMeses";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { currentMonthRange } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { loadCentrosDeCusto, type CentrosDeCustoData } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function lerPeriodo(params: { from?: string; to?: string }) {
  const padrao = currentMonthRange();
  const from = params.from && DATA_ISO.test(params.from) ? params.from : padrao.from;
  const to = params.to && DATA_ISO.test(params.to) ? params.to : padrao.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

export default async function Categorias({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; contas?: string | string[]; cat?: string }>;
}) {
  await requireSession();

  const params = await searchParams;
  const periodo = lerPeriodo(params);
  const accountIds = parseAccountIds(params.contas);

  let dados: CentrosDeCustoData;
  try {
    dados = await loadCentrosDeCusto(periodo, { accountIds });
  } catch (erro) {
    return (
      <main className="page">
        <div className="masthead">
          <h1>Categorias</h1>
        </div>
        <Nav atual="/categorias" contasQuery={accountQuery(accountIds)} />
        <p className="banner">
          {erro instanceof Error ? erro.message : "Erro ao carregar as categorias."}
        </p>
      </main>
    );
  }

  const contasQuery = accountQuery(dados.selectedAccountIds);
  return (
    <main className="page">
      <div className="masthead">
        <h1>Categorias e centros de custo</h1>
        <span className="period">
          Cada centro de custo e uma coisa concreta dentro da categoria — uma viagem, uma obra,
          uma pessoa.
        </span>
      </div>

      <Nav atual="/categorias" contasQuery={contasQuery} />

      {/* A fita fica fora dos outros controles porque no celular ela gruda no
          alto da tela, e um `sticky` so anda dentro do proprio pai. */}
      <div className="spinner-barra">
        <SpinnerDeMeses from={periodo.from} to={periodo.to} queryExtra={contasQuery} />
      </div>

      <div className="period-controls">
        <AccountFilter
          options={dados.accountOptions}
          selected={dados.selectedAccountIds}
          action="/categorias"
          hidden={{ from: periodo.from, to: periodo.to }}
        />

        {/* O de/ate continua aqui, so que em segundo plano: a fita responde a
            pergunta comum — "e neste mes?" — e este formulario responde as
            outras, como um ano inteiro ou os dias exatos de uma viagem. */}
        <form className="range-form" method="get">
          {/* Sem isto, escolher um periodo aqui desfazia o filtro de contas. */}
          {dados.selectedAccountIds.length > 0 ? (
            <input type="hidden" name="contas" value={dados.selectedAccountIds.join(",")} />
          ) : null}
          <label>
            De <input type="date" name="from" defaultValue={periodo.from} />
          </label>
          <label>
            ate <input type="date" name="to" defaultValue={periodo.to} />
          </label>
          <button type="submit">Ver</button>
        </form>
      </div>

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Despesas classificadas</div>
          <div className="tile-value negative">{formatBRL(-dados.despesas)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Receitas classificadas</div>
          <div className="tile-value positive">{formatBRL(dados.receitas)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Ainda sem categoria</div>
          <div className={`tile-value ${dados.semCategoria.sent > 0 ? "negative" : ""}`}>
            {formatBRL(-dados.semCategoria.sent)}
          </div>
          <div className="tile-note">
            {dados.semCategoria.counterparties}{" "}
            {dados.semCategoria.counterparties === 1 ? "contraparte" : "contrapartes"} ·{" "}
            <Link href={`/contrapartes?${buildQuery(`from=${periodo.from}&to=${periodo.to}`, contasQuery)}`}>
              classificar
            </Link>
          </div>
        </div>
      </div>

      <Indice
        categorias={dados.categorias}
        noAno={dados.noAno}
        aberta={params.cat ?? null}
        queryBase={buildQuery(`from=${periodo.from}&to=${periodo.to}`, contasQuery)}
      />

      <section>
        <h2>Mapa do gasto</h2>
        <div className="card">
          <TreemapCategorias categorias={dados.categorias} total={dados.despesas} />
        </div>
      </section>
    </main>
  );
}
