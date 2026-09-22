import { porFaixaDeImposto, type PapelNaCarteira } from "@/lib/finance/carteira";
import { formatBRL, formatPercent } from "@/lib/finance/money";

/**
 * Onde o dinheiro esta na tabela regressiva do imposto.
 *
 * A aliquota da renda fixa cai em degraus — 22,5% ate 180 dias, 20% ate 360,
 * 17,5% ate 720, 15% dali em diante — e no dia seguinte ao degrau o mesmo
 * resgate rende mais sem nada ter acontecido no mercado. Quem nao ve onde cada
 * lote esta, resgata no dia errado.
 *
 * A aliquota sai do proprio numero que a instituicao manda (imposto sobre
 * lucro), e nao da data da compra: essa a Pluggy nao envia. O preco disso e
 * que a tabela diz em que degrau o lote ESTA, e nao quantos dias faltam para o
 * proximo — a faixa de dias e a que a aliquota implica, nao a idade medida.
 */
export function FaixasDeImposto({ posicoes }: { posicoes: PapelNaCarteira[] }) {
  const faixas = porFaixaDeImposto(posicoes).filter((f) => f.aliquota !== null);
  if (faixas.length === 0) return null;

  const investido = faixas.reduce((s, f) => s + f.investido, 0);
  const imposto = faixas.reduce((s, f) => s + f.imposto, 0);
  if (investido <= 0) return null;

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        <span>Imposto · onde cada lote esta na tabela regressiva</span>
        <span className="account-meta">
          aliquota deduzida do imposto informado
        </span>
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela">
          <thead>
            <tr>
              <th scope="col">Aliquota</th>
              <th scope="col" className="gr-num">
                Investido
              </th>
              <th scope="col" className="gr-num">
                %
              </th>
              <th
                scope="col"
                className="gr-num"
                title="Quanto de imposto esta provisionado nestes lotes hoje"
              >
                Imposto
              </th>
            </tr>
          </thead>

          <tbody>
            {faixas.map((faixa) => (
              <tr key={faixa.aliquota}>
                <th scope="row">
                  {formatPercent(faixa.aliquota!, 1)}%
                  <span className="account-meta">
                    {" · "}
                    {faixa.ate === null
                      ? `${faixa.de} dias ou mais`
                      : `${faixa.de} a ${faixa.ate} dias`}
                  </span>
                </th>
                <td className="gr-num">{formatBRL(faixa.investido)}</td>
                <td className="gr-num">
                  {formatPercent((faixa.investido / investido) * 100, 1)}%
                </td>
                <td className="gr-num">{formatBRL(faixa.imposto)}</td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="gr-total">
              <th scope="row">Total</th>
              <td className="gr-num">{formatBRL(investido)}</td>
              <td className="gr-num">100,0%</td>
              <td className="gr-num">{formatBRL(imposto)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}
