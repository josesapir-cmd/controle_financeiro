import { formatBRL } from "@/lib/finance/money";
import type { CategoryTotal } from "@/lib/finance/summary";

/**
 * Comparacao de magnitude entre categorias: barras horizontais, ordenadas do
 * maior para o menor. Serie unica, entao um tom so — a cor nao carrega
 * identidade aqui, o rotulo carrega, e ciclar matizes sugeriria um significado
 * que nao existe. Cada barra leva rotulo direto com o valor, o que dispensa
 * legenda e mantem a leitura sem depender de cor.
 */
export function CategoryBars({ categories }: { categories: CategoryTotal[] }) {
  if (categories.length === 0) {
    return <p className="empty">Nenhum gasto registrado no periodo.</p>;
  }

  const maior = categories[0].total;

  return (
    <div className="bars">
      {categories.map((categoria) => {
        const largura = maior > 0 ? (categoria.total / maior) * 100 : 0;
        const percentual = Math.round(categoria.share * 100);

        return (
          <div className="bar-row" key={categoria.category}>
            <div className="bar-label" title={categoria.category}>
              {categoria.category}
            </div>
            <div
              className="bar-track"
              role="img"
              aria-label={`${categoria.category}: ${formatBRL(categoria.total)}, ${percentual}% dos gastos`}
            >
              <div
                className="bar-fill"
                style={{ width: `${Math.max(largura, 1)}%` }}
                title={`${categoria.count} ${categoria.count === 1 ? "lancamento" : "lancamentos"}`}
              />
            </div>
            <div className="bar-value">
              {formatBRL(categoria.total)}
              <span className="bar-share">{percentual}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
