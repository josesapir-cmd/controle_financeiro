import { formatBRL } from "@/lib/finance/money";
import type { DespesaPorConta } from "@/lib/finance/service";

/**
 * Total por conta, em tabela.
 *
 * A cor da instituicao em cada linha e orientacao, nao codificacao: o nome do
 * banco esta ao lado, entao a marca serve so para achar a linha rapido.
 *
 * Ordenada pelo valor, que e a pergunta: quem gastou mais.
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
  const maior = Math.max(...porValor.map((c) => c.total));

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
              {/* No celular o rotulo por extenso empurra os numeros para fora
                  da tela, e os valores da coluna ja sao porcentagens. */}
              <span className="gr-so-largo">Participacao</span>
              <span className="gr-so-estreito">%</span>
            </th>
            <th scope="col" className="gr-so-largo">
              Distribuicao
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
              <td className="gr-so-largo">
                <span className="gr-barra" aria-hidden>
                  <span style={{ width: `${Math.max(1, (conta.total / maior) * 100)}%` }} />
                </span>
              </td>
            </tr>
          ))}
          <tr className="gr-total">
            <th scope="row">Total</th>
            <td className="gr-num">{formatBRL(total)}</td>
            <td className="gr-num">100.0%</td>
            <td className="gr-so-largo" />
          </tr>
        </tbody>
        </table>
      </div>
    </figure>
  );
}
