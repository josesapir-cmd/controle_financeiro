import { formatBRL } from "@/lib/finance/money";
import type { DespesaPorCategoria } from "@/lib/finance/service";

/**
 * Distribuicao por categoria: barras e tabela, os mesmos numeros.
 *
 * Barra horizontal ordenada, e nao pizza nem treemap: a pergunta aqui e
 * comparar magnitudes entre dez categorias, e comprimento numa base comum e a
 * forma que o olho compara melhor.
 *
 * Uma matiz so nas barras. A identidade ja esta escrita no nome de cada linha,
 * entao dez cores diferentes nao acrescentariam informacao — acrescentariam o
 * arco-iris que faz a leitura piorar. A bolinha na cor da categoria fica ao
 * lado do nome, como no resto do app, onde ela e orientacao e nao codificacao.
 */
export function DespesasPorCategoria({
  categorias,
  total,
}: {
  categorias: DespesaPorCategoria[];
  /** Total do periodo, para a coluna de participacao. */
  total: number;
}) {
  if (categorias.length === 0) return null;

  const maior = Math.max(...categorias.map((c) => c.total));

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Por categoria · {categorias.length}{" "}
        {categorias.length === 1 ? "categoria" : "categorias"} com gasto
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela">
        <thead>
          <tr>
            <th scope="col">Categoria</th>
            <th scope="col" className="gr-num">
              Valor
            </th>
            <th scope="col" className="gr-num">
              Participacao
            </th>
            <th scope="col" className="gr-so-largo">
              Distribuicao
            </th>
          </tr>
        </thead>
        <tbody>
          {categorias.map((categoria) => {
            const fatia = total > 0 ? categoria.total / total : 0;

            return (
              <tr key={categoria.id ?? categoria.nome}>
                <th scope="row">
                  <span
                    className="gr-ponto"
                    style={{ "--cat-h": categoria.hue } as React.CSSProperties}
                    aria-hidden
                  />
                  {categoria.nome}
                  <span className="account-meta">
                    {" "}
                    · {categoria.contagem}{" "}
                    {categoria.contagem === 1 ? "lancamento" : "lancamentos"}
                  </span>
                </th>
                <td className="gr-num">{formatBRL(categoria.total)}</td>
                <td className="gr-num">{(fatia * 100).toFixed(1)}%</td>
                <td className="gr-so-largo">
                  <span className="gr-barra" aria-hidden>
                    <span style={{ width: `${Math.max(1, (categoria.total / maior) * 100)}%` }} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
        </table>
      </div>
    </figure>
  );
}
