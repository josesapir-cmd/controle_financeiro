import Link from "next/link";
import { listCategories } from "@/lib/counterparty-store";
import { maskDocument, NAO_IDENTIFICADA } from "@/lib/finance/counterparties";
import { currentMonthRange } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { loadCounterparties } from "@/lib/finance/service";
import { PeriodForm } from "./PeriodForm";
import { salvarContraparte } from "./actions";

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

export default async function Contrapartes({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const periodo = lerPeriodo(await searchParams);

  const [dados, categorias] = await Promise.all([
    loadCounterparties(periodo),
    listCategories(),
  ]);

  const identificadas = dados.counterparties.filter((c) => c.key !== NAO_IDENTIFICADA);
  const naoIdentificada = dados.counterparties.find((c) => c.key === NAO_IDENTIFICADA);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Contrapartes</h1>
        <span className="period">
          <Link href="/">Painel</Link> · <Link href="/conexoes">Conexoes</Link>
        </span>
      </div>

      <PeriodForm from={periodo.from} to={periodo.to} />

      {dados.isMock ? (
        <p className="banner">
          <strong>Dados ficticios.</strong> <code>PLUGGY_MOCK</code> esta ativo.
        </p>
      ) : null}

      {dados.failures.length > 0 ? (
        <p className="banner">
          <strong>Dados incompletos.</strong> {dados.failures.length}{" "}
          {dados.failures.length === 1 ? "conexao falhou" : "conexoes falharam"}:{" "}
          {dados.failures[0].message}
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
          <div className="tile-note">identificadas no periodo</div>
        </div>
      </div>

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

      <section>
        <h2>Movimentacao por contraparte</h2>

        {identificadas.length === 0 ? (
          <div className="card">
            <p className="empty">Nenhuma contraparte identificada neste periodo.</p>
          </div>
        ) : (
          <div className="card table-scroll">
            <table>
              <thead>
                <tr>
                  <th scope="col">Contraparte</th>
                  <th scope="col">Categoria</th>
                  <th scope="col" className="num">Enviado</th>
                  <th scope="col" className="num">Recebido</th>
                  <th scope="col" className="num">Liquido</th>
                  <th scope="col">Cadastro</th>
                </tr>
              </thead>
              <tbody>
                {identificadas.map((c) => (
                  <tr key={c.key}>
                    <td className="description">
                      {c.name}
                      {c.self ? <span className="tag">propria</span> : null}
                      <div className="account-meta">
                        {c.count} {c.count === 1 ? "movimentacao" : "movimentacoes"} · ultima em{" "}
                        {dataCurta.format(new Date(c.lastDate))}
                        {c.document ? ` · ${maskDocument(c.document, c.documentType)}` : ""}
                      </div>
                    </td>
                    <td>{c.category ?? "—"}</td>
                    <td className="amount">{c.sent > 0 ? formatBRL(-c.sent) : "—"}</td>
                    <td className="amount">{c.received > 0 ? formatBRL(c.received) : "—"}</td>
                    <td className={`amount ${c.net < 0 ? "negative" : "positive"}`}>
                      {formatBRL(c.net)}
                    </td>
                    <td>
                      <form action={salvarContraparte} className="inline-form">
                        <input type="hidden" name="key" value={c.key} />
                        <input
                          type="text"
                          name="category"
                          list="categorias"
                          placeholder="Categoria"
                          defaultValue={c.category ?? ""}
                          aria-label={`Categoria de ${c.name}`}
                        />
                        <input
                          type="text"
                          name="alias"
                          placeholder="Apelido"
                          defaultValue={c.name !== c.key ? c.name : ""}
                          aria-label={`Apelido de ${c.name}`}
                        />
                        <button type="submit">Salvar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <datalist id="categorias">
              {categorias.map((categoria) => (
                <option key={categoria} value={categoria} />
              ))}
            </datalist>
          </div>
        )}
      </section>
    </main>
  );
}
