import { Fragment } from "react";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { AccountFilter } from "@/components/AccountFilter";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { translateCategory } from "@/lib/finance/categories";
import {
  groupByCategory,
  maskDocument,
  NAO_IDENTIFICADA,
  type CounterpartyTotal,
} from "@/lib/finance/counterparties";
import { currentMonthRange, localTime } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { Sugestao } from "@/lib/finance/conciliacao";
import { loadCounterparties, loadTaxonomy, type Decisao } from "@/lib/finance/service";
import { PeriodForm } from "./PeriodForm";
import {
  reverDecisao,
  salvarContraparte,
  separarContrapartes,
  unirContrapartes,
} from "./actions";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

/** So aceitamos datas no formato esperado; qualquer outra coisa cai no padrao. */
function lerPeriodo(params: { from?: string; to?: string }) {
  const padrao = currentMonthRange();
  const from = params.from && DATA_ISO.test(params.from) ? params.from : padrao.from;
  const to = params.to && DATA_ISO.test(params.to) ? params.to : padrao.to;
  return from <= to ? { from, to } : { from: to, to: from };
}

const dataCurta = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit" });

function Classificacao({ c }: { c: CounterpartyTotal }) {
  if (!c.category && !c.subcategory) return <>—</>;
  return (
    <>
      {c.category ?? "—"}
      {c.subcategory ? (
        <div className="account-meta">↳ {c.subcategory}</div>
      ) : null}
    </>
  );
}

/**
 * Identidade da contraparte com um botao proprio para expandir.
 *
 * O caret e um link para a mesma pagina com ?open=<key>, e as transacoes saem em
 * <tr> irmas. Assim a linha da contraparte nao muda de altura nem de largura ao
 * abrir — colocar o conteudo expansivel dentro da celula refluia a tabela toda.
 */
function IdentidadeContraparte({
  c,
  aberta,
  alternarPara,
}: {
  c: CounterpartyTotal;
  aberta: boolean;
  alternarPara: string;
}) {
  return (
    <div className="identidade">
      <Link
        className="caret"
        href={alternarPara}
        aria-expanded={aberta}
        aria-label={`${aberta ? "Fechar" : "Abrir"} lancamentos de ${c.name}`}
        scroll={false}
      >
        {aberta ? "▴" : "▾"}
      </Link>
      <div>
        <span className="description">{c.name}</span>
        {c.self ? <span className="tag">propria</span> : null}
        {/* O nome oficial so aparece quando o apelido o esconde: sem apelido,
            ele ja e o titulo, e repeti-lo seria ruido. */}
        {c.alias && c.officialName && c.officialName !== c.alias ? (
          <div className="account-meta oficial">{c.officialName}</div>
        ) : null}
        <div className="account-meta">
          {c.count} {c.count === 1 ? "movimentacao" : "movimentacoes"} · ultima em{" "}
          {dataCurta.format(new Date(c.lastDate))}
          {c.document ? ` · ${maskDocument(c.document, c.documentType)}` : ""}
        </div>
      </div>
    </div>
  );
}

/**
 * Contrapartes que parecem ser a mesma com nomes de tamanhos diferentes.
 *
 * O caso e o print do saldo compartilhado, que corta o nome do estabelecimento
 * enquanto o Open Finance o entrega inteiro. Uniao errada mistura o gasto de
 * dois lugares, entao o que e ambiguo espera decisao e o que foi unido sozinho
 * continua visivel e reversivel — nada acontece em silencio.
 */
function Conciliacoes({
  sugestoes,
  decididas,
}: {
  sugestoes: Sugestao[];
  decididas: Decisao[];
}) {
  const automaticas = sugestoes.filter((s) => s.automatica);
  const aguardando = sugestoes.filter((s) => !s.automatica);
  const separadas = decididas.filter((d) => d.para === null);
  const unidas = decididas.filter((d) => d.para !== null);

  if (sugestoes.length === 0 && decididas.length === 0) return null;

  return (
    <section className="conciliacoes">
      <h2>Contrapartes com o mesmo nome em tamanhos diferentes</h2>
      <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
        Print de tela corta o nome do estabelecimento; o Open Finance traz o nome inteiro. Quando
        sao a mesma contraparte, unir mantem o historico e a classificacao num lugar so.
      </p>

      {aguardando.length > 0 ? (
        <div className="card">
          <h2>Precisam da sua decisao ({aguardando.length})</h2>
          <ul className="conciliacao-lista">
            {aguardando.map((s) => (
              <li key={s.de}>
                <div>
                  <span className="description">{s.nomeDe}</span>
                  <span className="seta">→</span>
                  <span className="description">{s.nomePara}</span>
                  <div className="account-meta">{s.motivo}</div>
                </div>
                <div className="conciliacao-acoes">
                  <form action={unirContrapartes}>
                    <input type="hidden" name="de" value={s.de} />
                    <input type="hidden" name="para" value={s.para} />
                    <button type="submit">E a mesma</button>
                  </form>
                  <form action={separarContrapartes}>
                    <input type="hidden" name="de" value={s.de} />
                    <button type="submit" className="danger">
                      Sao diferentes
                    </button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {automaticas.length > 0 || unidas.length > 0 ? (
        <details className="bloco-prontas" style={{ marginTop: 12 }}>
          <summary>
            <span className="description">
              {automaticas.length + unidas.length} ja unidas
            </span>
            <span className="account-meta">abrir para revisar ou separar</span>
          </summary>
          <div className="card" style={{ marginTop: 12 }}>
            <ul className="conciliacao-lista">
              {automaticas.map((s) => (
                <li key={s.de}>
                  <div>
                    <span className="description">{s.nomeDe}</span>
                    <span className="seta">→</span>
                    <span className="description">{s.nomePara}</span>
                    <div className="account-meta">unida sozinha · {s.motivo}</div>
                  </div>
                  <form action={separarContrapartes}>
                    <input type="hidden" name="de" value={s.de} />
                    <button type="submit" className="danger">
                      Separar
                    </button>
                  </form>
                </li>
              ))}
              {unidas.map((d) => (
                <li key={d.de}>
                  <div>
                    <span className="description">{d.nomeDe}</span>
                    <span className="seta">→</span>
                    <span className="description">{d.nomePara}</span>
                    <div className="account-meta">unida por voce</div>
                  </div>
                  <form action={separarContrapartes}>
                    <input type="hidden" name="de" value={d.de} />
                    <button type="submit" className="danger">
                      Separar
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}

      {separadas.length > 0 ? (
        <details className="bloco-prontas" style={{ marginTop: 12 }}>
          <summary>
            <span className="description">{separadas.length} mantidas separadas</span>
            <span className="account-meta">abrir para rever</span>
          </summary>
          <div className="card" style={{ marginTop: 12 }}>
            <ul className="conciliacao-lista">
              {separadas.map((d) => (
                <li key={d.de}>
                  <div>
                    <span className="description">{d.nomeDe}</span>
                    <div className="account-meta">voce marcou como contraparte propria</div>
                  </div>
                  <form action={reverDecisao}>
                    <input type="hidden" name="de" value={d.de} />
                    <button type="submit" className="danger">
                      Rever
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          </div>
        </details>
      ) : null}
    </section>
  );
}

/**
 * Uma <tr> por lancamento, com o mesmo numero de celulas da tabela que a contem.
 * Mostra todos os campos que a Pluggy entrega para aquele lancamento — e o que
 * permite separar, por exemplo, parcelas de contratos diferentes.
 */
function LinhasDeLancamentos({
  c,
  colunas,
  accountNames,
}: {
  c: CounterpartyTotal;
  colunas: number;
  accountNames: Record<string, string>;
}) {
  return (
    <>
      {c.transactions.map((lancamento) => {
        const conta = lancamento.accountId ? accountNames[lancamento.accountId] : undefined;
        const detalhes = lancamento.details ?? [];

        return (
          <tr className="linha-detalhe" key={`${c.key}-${lancamento.id}`}>
            <td colSpan={Math.max(colunas - 1, 1)}>
              <div className="detalhe-cabecalho">
                <span className="detalhe-quando">
                  {dataCurta.format(new Date(lancamento.date))} {localTime(lancamento.date)}
                </span>
                <span className="detalhe-descricao">{lancamento.description}</span>
              </div>

              <dl className="detalhe-campos">
                {conta ? (
                  <div>
                    <dt>Conta</dt>
                    <dd>{conta}</dd>
                  </div>
                ) : null}
                {lancamento.category ? (
                  <div>
                    <dt>Categoria</dt>
                    <dd>{translateCategory(lancamento.category)}</dd>
                  </div>
                ) : null}
                {detalhes.map((detalhe) => (
                  <div key={`${detalhe.label}-${detalhe.value}`}>
                    <dt>{detalhe.label}</dt>
                    <dd>{detalhe.value}</dd>
                  </div>
                ))}
              </dl>
            </td>
            <td className={`amount ${lancamento.amount < 0 ? "negative" : "positive"}`}>
              {formatBRL(lancamento.amount)}
            </td>
          </tr>
        );
      })}
    </>
  );
}

function Valores({ c }: { c: CounterpartyTotal }) {
  return (
    <>
      <td className="amount">{c.sent > 0 ? formatBRL(-c.sent) : "—"}</td>
      <td className="amount">{c.received > 0 ? formatBRL(c.received) : "—"}</td>
      <td className={`amount ${c.net < 0 ? "negative" : "positive"}`}>{formatBRL(c.net)}</td>
    </>
  );
}

/**
 * Formulario de classificacao. A categoria vem preenchida com a sugestao quando
 * a contraparte ainda nao foi classificada — um clique em Salvar confirma, mas
 * nada e dado como classificado sem esse clique.
 */
function FormularioClassificacao({ c, voltarPara }: { c: CounterpartyTotal; voltarPara?: string }) {
  return (
    <form action={salvarContraparte} className="inline-form">
      <input type="hidden" name="key" value={c.key} />
      <input
        type="text"
        name="category"
        list="categorias"
        placeholder="Categoria"
        defaultValue={c.category ?? c.suggestedCategory ?? ""}
        aria-label={`Categoria de ${c.name}`}
      />
      <input
        type="text"
        name="subcategory"
        list="subcategorias"
        placeholder="Subcategoria"
        defaultValue={c.subcategory ?? ""}
        aria-label={`Subcategoria de ${c.name}`}
      />
      <input
        type="text"
        name="officialName"
        placeholder="Nome oficial"
        defaultValue={c.officialName ?? ""}
        aria-label={`Nome oficial de ${c.name}`}
        title="Como aparece no extrato"
      />
      <input
        type="text"
        name="alias"
        placeholder="Apelido"
        defaultValue={c.alias ?? ""}
        aria-label={`Apelido de ${c.name}`}
        title="Como voce chama esta contraparte"
      />
      <button type="submit">Salvar</button>
      {voltarPara ? (
        <Link className="cancelar" href={voltarPara} scroll={false}>
          Cancelar
        </Link>
      ) : null}
    </form>
  );
}

export default async function Contrapartes({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    internas?: string;
    edit?: string;
    open?: string;
    contas?: string | string[];
  }>;
}) {
  await requireSession();

  const params = await searchParams;
  const periodo = lerPeriodo(params);
  const incluirInternas = params.internas === "1";

  const accountIds = parseAccountIds(params.contas);
  const contasQuery = accountQuery(accountIds);

  const [dados, taxonomia] = await Promise.all([
    loadCounterparties(periodo, { includeInternal: incluirInternas, accountIds }),
    loadTaxonomy(),
  ]);

  const queryPeriodo = buildQuery(
    `from=${periodo.from}&to=${periodo.to}`,
    incluirInternas ? "internas=1" : undefined,
    contasQuery,
  );
  const editando = params.edit;
  const aberta = params.open;
  const voltarPara = `/contrapartes?${queryPeriodo}`;

  /** Link que abre a contraparte, ou fecha se ela ja estiver aberta. */
  const alternar = (key: string) =>
    aberta === key
      ? `/contrapartes?${queryPeriodo}`
      : `/contrapartes?${queryPeriodo}&open=${encodeURIComponent(key)}`;
  const identificadas = dados.counterparties.filter((c) => c.key !== NAO_IDENTIFICADA);
  const naoIdentificada = dados.counterparties.find((c) => c.key === NAO_IDENTIFICADA);
  const porCategoria = groupByCategory(identificadas);

  // Classificada e o que o usuario confirmou. Sugestao nao classifica nada.
  const classificadas = identificadas.filter((c) => c.category);
  const pendentes = identificadas.filter((c) => !c.category);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Contrapartes</h1>
      </div>

      <Nav atual="/contrapartes" contasQuery={contasQuery} />

      <PeriodForm from={periodo.from} to={periodo.to} accountIds={accountIds} />

      <div className="filtros">
        <AccountFilter
          options={dados.accountOptions}
          selected={accountIds}
          action="/contrapartes"
          hidden={{
            from: periodo.from,
            to: periodo.to,
            internas: incluirInternas ? "1" : undefined,
          }}
        />
        <Link
          className={incluirInternas ? "preset" : "preset ativo"}
          href={`/contrapartes?${buildQuery(`from=${periodo.from}&to=${periodo.to}`, contasQuery)}`}
        >
          So contrapartes externas
        </Link>
        <Link
          className={incluirInternas ? "preset ativo" : "preset"}
          href={`/contrapartes?${buildQuery(
            `from=${periodo.from}&to=${periodo.to}`,
            "internas=1",
            contasQuery,
          )}`}
        >
          Incluir movimentacoes internas
        </Link>
      </div>

      {dados.isMock ? (
        <p className="banner">
          <strong>Dados ficticios.</strong> <code>PLUGGY_MOCK</code> esta ativo.
        </p>
      ) : null}

      {dados.failures.length > 0 ? (
        <p className="banner">
          <strong>Dados incompletos.</strong> {dados.failures[0].message}
        </p>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Enviado no periodo</div>
          <div className="tile-value negative">{formatBRL(dados.totalSent)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Recebido no periodo</div>
          <div className="tile-value positive">{formatBRL(dados.totalReceived)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Contrapartes</div>
          <div className="tile-value">{identificadas.length}</div>
          <div className="tile-note">
            {classificadas.length} classificada{classificadas.length === 1 ? "" : "s"}
          </div>
        </div>
      </div>

      {!incluirInternas && dados.internalCount > 0 ? (
        <p className="period" style={{ display: "block", marginTop: 16 }}>
          {dados.internalCount}{" "}
          {dados.internalCount === 1
            ? "lancamento interno omitido"
            : "lancamentos internos omitidos"}
          : transferencias entre suas contas e aplicacoes.
        </p>
      ) : null}

      {naoIdentificada ? (
        <p className="banner">
          <strong>
            {naoIdentificada.count}{" "}
            {naoIdentificada.count === 1 ? "transacao" : "transacoes"} sem contraparte
          </strong>{" "}
          ({formatBRL(naoIdentificada.received + naoIdentificada.sent)}). Em transferencias
          recebidas, o banco nem sempre informa quem enviou — o dado nao existe na origem.
        </p>
      ) : null}

      <Conciliacoes
        sugestoes={dados.conciliacoes}
        decididas={dados.conciliacoesDecididas}
      />

      {classificadas.length > 0 ? (
        <section>
          <h2>Totais por categoria</h2>
          <div className="card">
            <ul className="rollup">
              {porCategoria.map((categoria) => (
                <li key={categoria.category}>
                  <div className="rollup-linha">
                    <span className="description">{categoria.category}</span>
                    <span className="bar-value">
                      {categoria.sent > 0 ? formatBRL(-categoria.sent) : formatBRL(categoria.received)}
                    </span>
                  </div>
                  <ul>
                    {categoria.subcategories.map((sub) => (
                      <li key={sub.subcategory}>
                        <div className="rollup-linha sub">
                          <span>
                            {sub.subcategory}
                            <span className="account-meta">
                              {" "}
                              · {sub.counterparties}{" "}
                              {sub.counterparties === 1 ? "contraparte" : "contrapartes"}
                            </span>
                          </span>
                          <span className="bar-value">
                            {sub.sent > 0 ? formatBRL(-sub.sent) : formatBRL(sub.received)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}

      <section>
        <h2>
          Aguardando classificacao{pendentes.length > 0 ? ` (${pendentes.length})` : ""}
        </h2>

        {pendentes.length === 0 ? (
          <div className="card">
            <p className="empty">
              Tudo classificado neste periodo. Contrapartes novas aparecem aqui.
            </p>
          </div>
        ) : (
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Contraparte</th>
                  <th scope="col" className="num">Enviado</th>
                  <th scope="col" className="num">Recebido</th>
                  <th scope="col" className="num">Liquido</th>
                  <th scope="col">Classificar</th>
                </tr>
              </thead>
              <tbody>
                {pendentes.map((c) => (
                  <Fragment key={c.key}>
                    <tr>
                      <td className="description">
                        <IdentidadeContraparte
                          c={c}
                          aberta={aberta === c.key}
                          alternarPara={alternar(c.key)}
                        />
                      </td>
                      <Valores c={c} />
                      <td>
                        <FormularioClassificacao c={c} />
                      </td>
                    </tr>
                    {aberta === c.key ? (
                      <LinhasDeLancamentos c={c} colunas={5} accountNames={dados.accountNames} />
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {classificadas.length > 0 ? (
        <section>
          <h2>Classificadas ({classificadas.length})</h2>
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Contraparte</th>
                  <th scope="col" className="num">Enviado</th>
                  <th scope="col" className="num">Recebido</th>
                  <th scope="col" className="num">Liquido</th>
                  <th scope="col">Categoria</th>
                  <th scope="col">Subcategoria</th>
                  <th scope="col" aria-label="Acoes" />
                </tr>
              </thead>
              <tbody>
                {classificadas.map((c) => (
                  <Fragment key={c.key}>
                    {editando === c.key ? (
                      <tr>
                        <td className="description">
                          <IdentidadeContraparte
                            c={c}
                            aberta={aberta === c.key}
                            alternarPara={alternar(c.key)}
                          />
                        </td>
                        <Valores c={c} />
                        <td colSpan={3}>
                          <FormularioClassificacao c={c} voltarPara={voltarPara} />
                        </td>
                      </tr>
                    ) : (
                      <tr className="linha-classificada">
                        <td className="description">
                          <IdentidadeContraparte
                            c={c}
                            aberta={aberta === c.key}
                            alternarPara={alternar(c.key)}
                          />
                        </td>
                        <Valores c={c} />
                        <td>{c.category}</td>
                        <td>{c.subcategory ?? "—"}</td>
                        <td>
                          <Link
                            className="editar"
                            href={`/contrapartes?${queryPeriodo}&edit=${encodeURIComponent(c.key)}`}
                            scroll={false}
                          >
                            Editar
                          </Link>
                        </td>
                      </tr>
                    )}
                    {aberta === c.key ? (
                      <LinhasDeLancamentos c={c} colunas={7} accountNames={dados.accountNames} />
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <datalist id="categorias">
        {taxonomia.categories.map((categoria) => (
          <option key={categoria} value={categoria} />
        ))}
      </datalist>
      <datalist id="subcategorias">
        {taxonomia.subcategories.map((sub) => (
          <option key={sub} value={sub} />
        ))}
      </datalist>

    </main>
  );
}
