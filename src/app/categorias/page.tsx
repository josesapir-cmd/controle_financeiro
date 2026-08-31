import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { AccountFilter } from "@/components/AccountFilter";
import { Nav } from "@/components/Nav";
import { TreemapCategorias } from "@/components/TreemapCategorias";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import type { CategoriaTotal, CentroTotal } from "@/lib/finance/centros";
import { currentMonthRange } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { loadCentrosDeCusto, type CentrosDeCustoData } from "@/lib/finance/service";
import {
  adicionarCentro,
  alternarCategoria,
  alternarCentro,
  criarCategoria,
  editarCategoria,
  editarCentro,
} from "./actions";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function lerPeriodo(params: { from?: string; to?: string }) {
  const padrao = currentMonthRange();
  const from = params.from && DATA_ISO.test(params.from) ? params.from : padrao.from;
  const to = params.to && DATA_ISO.test(params.to) ? params.to : padrao.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

const TIPOS: Record<string, string> = {
  despesa: "Despesa",
  receita: "Receita",
  movimentacao: "Movimentacao",
};

/** Barra de consumo do orcamento. Passa de 100% sem quebrar: estourar e o dado. */
function Orcamento({ centro }: { centro: CentroTotal }) {
  if (!centro.budget) return null;

  const usado = centro.budgetUsed ?? 0;
  const estourou = usado > 1;

  return (
    <div className="orcamento">
      <div className="bar-track">
        <div
          className={`bar-fill ${estourou ? "estourado" : ""}`}
          style={{ width: `${Math.min(usado, 1) * 100}%` }}
        />
      </div>
      <span className={`account-meta ${estourou ? "negative" : ""}`}>
        {formatBRL(centro.sent)} de {formatBRL(centro.budget)} · {Math.round(usado * 100)}%
        {estourou ? " — estourou" : ""}
      </span>
    </div>
  );
}

function LinhaDeCentro({ centro, aberto }: { centro: CentroTotal; aberto: string | null }) {
  const editando = aberto === centro.id;

  return (
    <li className={centro.count === 0 ? "centro vazio" : "centro"}>
      <div className="centro-topo">
        <div className="centro-identidade">
          <span className="description">{centro.name}</span>
          {centro.startsOn || centro.endsOn ? (
            <span className="tag">
              {centro.startsOn?.slice(8, 10)}/{centro.startsOn?.slice(5, 7)}
              {centro.endsOn ? ` a ${centro.endsOn.slice(8, 10)}/${centro.endsOn.slice(5, 7)}` : ""}
            </span>
          ) : null}
          <div className="account-meta">
            {centro.count === 0
              ? "sem lancamentos no periodo"
              : `${centro.count} ${centro.count === 1 ? "lancamento" : "lancamentos"} · ${centro.counterparties} ${centro.counterparties === 1 ? "contraparte" : "contrapartes"}`}
            {centro.note ? ` · ${centro.note}` : ""}
          </div>
        </div>

        <div className="centro-valores">
          <span className="amount">{centro.sent > 0 ? formatBRL(-centro.sent) : "—"}</span>
          {centro.received > 0 ? (
            <span className="account-meta positive">+{formatBRL(centro.received)}</span>
          ) : null}
        </div>
      </div>

      <Orcamento centro={centro} />

      <details open={editando}>
        <summary className="account-meta">Ajustar</summary>
        <form action={editarCentro} className="inline-form" style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={centro.id} />
          <input type="text" name="name" defaultValue={centro.name} aria-label="Nome" />
          <input
            type="text"
            name="note"
            defaultValue={centro.note ?? ""}
            placeholder="Observacao"
            aria-label="Observacao"
          />
          <input
            type="date"
            name="startsOn"
            defaultValue={centro.startsOn ?? ""}
            aria-label="Comeco"
          />
          <input type="date" name="endsOn" defaultValue={centro.endsOn ?? ""} aria-label="Fim" />
          <input
            type="text"
            inputMode="decimal"
            name="budget"
            defaultValue={centro.budget ? String(centro.budget) : ""}
            placeholder="Orcamento"
            aria-label="Orcamento"
          />
          <button type="submit">Salvar</button>
        </form>
        <form action={alternarCentro} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={centro.id} />
          <input type="hidden" name="arquivado" value="nao" />
          <button type="submit" className="danger">
            Arquivar centro
          </button>
        </form>
      </details>
    </li>
  );
}

function Categoria({ categoria }: { categoria: CategoriaTotal }) {
  const temMovimento = categoria.count > 0;

  return (
    <section className="card categoria">
      <div className="categoria-topo">
        <div>
          <h2 style={{ marginBottom: 2 }}>{categoria.name}</h2>
          <div className="account-meta">
            {TIPOS[categoria.kind] ?? categoria.kind} · {categoria.centros.length}{" "}
            {categoria.centros.length === 1 ? "centro de custo" : "centros de custo"}
            {temMovimento ? ` · ${categoria.count} lancamentos` : ""}
          </div>
        </div>
        <div className="categoria-total">
          {categoria.kind === "receita"
            ? formatBRL(categoria.received)
            : formatBRL(-categoria.sent)}
        </div>
      </div>

      {categoria.centros.length > 0 ? (
        <ul className="centros">
          {categoria.centros.map((centro) => (
            <LinhaDeCentro key={centro.id} centro={centro} aberto={null} />
          ))}
        </ul>
      ) : (
        <p className="empty" style={{ marginTop: 12 }}>
          Nenhum centro de custo ainda. Crie um para separar o gasto desta categoria por viagem,
          por obra ou por pessoa.
        </p>
      )}

      {/* Gasto que caiu na categoria sem centro: trabalho pela metade, entao
          aparece separado em vez de somar em silencio com o resto. */}
      {categoria.semCentro.count > 0 ? (
        <p className="sem-centro">
          <strong>{formatBRL(-categoria.semCentro.sent)}</strong> em{" "}
          {categoria.semCentro.count}{" "}
          {categoria.semCentro.count === 1 ? "lancamento" : "lancamentos"} nesta categoria sem
          centro de custo. Atribua um em <Link href="/contrapartes">Contrapartes</Link>.
        </p>
      ) : null}

      <form action={adicionarCentro} className="inline-form" style={{ marginTop: 14 }}>
        <input type="hidden" name="categoryId" value={categoria.id} />
        <input
          type="text"
          name="name"
          placeholder="Novo centro de custo"
          aria-label={`Novo centro de custo em ${categoria.name}`}
        />
        <button type="submit">Adicionar</button>
      </form>

      <details style={{ marginTop: 10 }}>
        <summary className="account-meta">Editar categoria</summary>
        <form action={editarCategoria} className="inline-form" style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={categoria.id} />
          <input type="text" name="name" defaultValue={categoria.name} aria-label="Nome" />
          <select name="kind" defaultValue={categoria.kind} aria-label="Tipo">
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="movimentacao">Movimentacao</option>
          </select>
          <button type="submit">Salvar</button>
        </form>
        <form action={alternarCategoria} style={{ marginTop: 8 }}>
          <input type="hidden" name="id" value={categoria.id} />
          <input type="hidden" name="arquivada" value="nao" />
          <button type="submit" className="danger">
            Arquivar categoria
          </button>
        </form>
      </details>
    </section>
  );
}

export default async function Categorias({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; contas?: string | string[] }>;
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
  const comMovimento = dados.categorias.filter((c) => c.count > 0);
  const semMovimento = dados.categorias.filter((c) => c.count === 0);

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

      <div className="period-controls">
        <form className="range-form" method="get">
          <label>
            De <input type="date" name="from" defaultValue={periodo.from} />
          </label>
          <label>
            ate <input type="date" name="to" defaultValue={periodo.to} />
          </label>
          <button type="submit">Ver</button>
        </form>

        <AccountFilter
          options={dados.accountOptions}
          selected={dados.selectedAccountIds}
          action="/categorias"
          hidden={{ from: periodo.from, to: periodo.to }}
        />
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

      <section>
        <h2>Mapa do gasto</h2>
        <div className="card">
          <TreemapCategorias categorias={dados.categorias} total={dados.despesas} />
        </div>
      </section>

      {comMovimento.map((categoria) => (
        <Categoria key={categoria.id} categoria={categoria} />
      ))}

      {semMovimento.length > 0 ? (
        <section>
          <h2>Sem movimento no periodo ({semMovimento.length})</h2>
          {semMovimento.map((categoria) => (
            <Categoria key={categoria.id} categoria={categoria} />
          ))}
        </section>
      ) : null}

      <section className="card">
        <h2>Nova categoria</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          As categorias iniciais vieram do Poupa.ai, onde sua assistente ja classifica os gastos do
          saldo compartilhado — usar a mesma taxonomia dos dois lados evita traduzir na importacao.
        </p>
        <form action={criarCategoria} className="inline-form">
          <input type="text" name="name" placeholder="Nome" aria-label="Nome da categoria" />
          <select name="kind" defaultValue="despesa" aria-label="Tipo">
            <option value="despesa">Despesa</option>
            <option value="receita">Receita</option>
            <option value="movimentacao">Movimentacao</option>
          </select>
          <button type="submit">Criar</button>
        </form>
      </section>
    </main>
  );
}
