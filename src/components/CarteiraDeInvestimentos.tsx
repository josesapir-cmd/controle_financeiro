import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { Carteira } from "@/lib/finance/service";
import { TabelaDePapeis } from "./TabelaDePapeis";

/**
 * A carteira que veio do Open Finance.
 *
 * Fotografia do que existe hoje, e nao extrato: nao tem periodo, e o numero que
 * importa e o saldo de mercado. O lucro aparece ao lado quando a instituicao
 * informa — e so quando informa, porque zero diria que nao rendeu nada, que e
 * outra afirmacao.
 *
 * Uma matiz so nas barras: o nome da classe ja esta escrito na linha, e dar uma
 * cor a cada uma acrescentaria arco-iris, nao informacao.
 */
export function CarteiraDeInvestimentos({ carteira }: { carteira: Carteira }) {
  if (carteira.papeis.length === 0) {
    return (
      <section className="gr">
        <figcaption className="gr-titulo">Carteira</figcaption>
        <p className="empty" style={{ margin: 0 }}>
          Nenhuma posicao sincronizada. Elas chegam junto com o extrato, das
          conexoes que expoem investimento — rode uma sincronizacao em{" "}
          <strong>Conexoes</strong>.
        </p>
      </section>
    );
  }

  const maiorClasse = Math.max(...carteira.porClasse.map((g) => g.total), 1);
  const maiorInstituicao = Math.max(
    ...carteira.porInstituicao.map((g) => g.total),
    1,
  );
  const rendimento =
    carteira.lucro !== null && carteira.total - carteira.lucro > 0
      ? carteira.lucro / (carteira.total - carteira.lucro)
      : null;

  return (
    <>
      <section className="card cp-resumo">
        <div className="cp-resumo-topo">
          <div className="tile-label">Carteira</div>
          {carteira.vistoEm ? (
            <span className="account-meta">
              posicao de{" "}
              {dataCompleta(carteira.vistoEm.toISOString().slice(0, 10))}
            </span>
          ) : null}
        </div>

        <div className="tile-value">{formatBRL(carteira.total)}</div>

        <div className="tile-note">
          {carteira.papeis.length}{" "}
          {carteira.papeis.length === 1 ? "papel" : "papeis"} em{" "}
          {carteira.porInstituicao.length}{" "}
          {carteira.porInstituicao.length === 1
            ? "instituicao"
            : "instituicoes"}
          {carteira.lucro !== null ? (
            <>
              {" · "}
              <span className="positive">{formatBRL(carteira.lucro)}</span> de
              lucro
              {rendimento !== null
                ? ` (${(rendimento * 100).toFixed(1)}%)`
                : ""}
            </>
          ) : null}
        </div>
      </section>

      <figure className="gr">
        <figcaption className="gr-titulo">Por classe</figcaption>
        <div className="gr-rolagem">
          <table className="gr-tabela">
            <thead>
              <tr>
                <th scope="col">Classe</th>
                <th scope="col" className="gr-num">
                  Valor
                </th>
                <th scope="col" className="gr-num">
                  <span className="gr-so-largo">Participacao</span>
                  <span className="gr-so-estreito">%</span>
                </th>
                <th scope="col" className="gr-so-largo">
                  Distribuicao
                </th>
              </tr>
            </thead>
            <tbody>
              {carteira.porClasse.map((grupo) => (
                <tr key={grupo.nome}>
                  <th scope="row">
                    {grupo.nome}
                    <span className="gr-badge">{grupo.papeis}</span>
                  </th>
                  <td className="gr-num">{formatBRL(grupo.total)}</td>
                  <td className="gr-num">
                    {carteira.total > 0
                      ? `${((grupo.total / carteira.total) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="gr-so-largo">
                    <span className="gr-barra" aria-hidden>
                      <span
                        style={{
                          width: `${Math.max(1, (grupo.total / maiorClasse) * 100)}%`,
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>

      <figure className="gr">
        <figcaption className="gr-titulo">Por instituicao</figcaption>
        <div className="gr-rolagem">
          <table className="gr-tabela">
            <thead>
              <tr>
                <th scope="col">Instituicao</th>
                <th scope="col" className="gr-num">
                  Valor
                </th>
                <th scope="col" className="gr-num">
                  <span className="gr-so-largo">Participacao</span>
                  <span className="gr-so-estreito">%</span>
                </th>
                <th scope="col" className="gr-so-largo">
                  Distribuicao
                </th>
              </tr>
            </thead>
            <tbody>
              {carteira.porInstituicao.map((grupo) => (
                <tr key={grupo.nome}>
                  <th scope="row">
                    {grupo.nome}
                    <span className="gr-badge">{grupo.papeis}</span>
                  </th>
                  <td className="gr-num">{formatBRL(grupo.total)}</td>
                  <td className="gr-num">
                    {carteira.total > 0
                      ? `${((grupo.total / carteira.total) * 100).toFixed(1)}%`
                      : "—"}
                  </td>
                  <td className="gr-so-largo">
                    <span className="gr-barra" aria-hidden>
                      <span
                        style={{
                          width: `${Math.max(1, (grupo.total / maiorInstituicao) * 100)}%`,
                        }}
                      />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </figure>

      <TabelaDePapeis posicoes={carteira.posicoes} />
    </>
  );
}
