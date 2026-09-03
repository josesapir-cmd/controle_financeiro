import { formatBRL } from "@/lib/finance/money";
import type { DespesaPorConta } from "@/lib/finance/service";

/**
 * Total por conta, em tabela.
 *
 * A mesma cor do grafico acumulado em cada linha: e o que liga a faixa da area
 * ao numero exato, sem obrigar a medir a faixa no olho.
 *
 * A ordem aqui e a do VALOR, nao a da pilha. Sao perguntas diferentes: a pilha
 * ordena para as cores nao se confundirem, a tabela ordena para responder
 * "quem gastou mais".
 */
export function DespesasPorConta({
  contas,
  total,
}: {
  contas: DespesaPorConta[];
  total: number;
}) {
  if (contas.length === 0) return null;

  const porValor = [...contas].sort((a, b) => b.total - a.total);

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Por conta · {contas.length} {contas.length === 1 ? "conta" : "contas"} com gasto
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela">
        <thead>
          <tr>
            <th scope="col">Conta</th>
            <th scope="col" className="gr-num">
              Valor
            </th>
            <th scope="col" className="gr-num">
              Participacao
            </th>
          </tr>
        </thead>
        <tbody>
          {porValor.map((conta) => (
            <tr key={conta.id}>
              <th scope="row">
                <span className="gr-marca" style={{ background: conta.cor }} aria-hidden />
                {conta.nome}
              </th>
              <td className="gr-num">{formatBRL(conta.total)}</td>
              <td className="gr-num">
                {total > 0 ? ((conta.total / total) * 100).toFixed(1) : "0.0"}%
              </td>
            </tr>
          ))}
          <tr className="gr-total">
            <th scope="row">Total</th>
            <td className="gr-num">{formatBRL(total)}</td>
            <td className="gr-num">100.0%</td>
          </tr>
        </tbody>
        </table>
      </div>
    </figure>
  );
}
