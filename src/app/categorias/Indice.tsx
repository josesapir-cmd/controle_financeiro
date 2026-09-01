import Link from "next/link";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import type { CategoriaTotal, CentroTotal } from "@/lib/finance/centros";

/**
 * Indice de categorias em blocos de cor, com o painel da categoria aberta
 * logo abaixo.
 *
 * Uma categoria aberta por vez, e a selecao mora na URL (`?cat=`): a tela
 * continua sendo renderizada no servidor, o botao voltar funciona e o link e
 * compartilhavel — como ja acontece com a expansao de contraparte.
 */

/** Numero grande sem simbolo nem sinal: tudo no bloco e despesa. */
const MES = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ANO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

function periodo(centro: CentroTotal): string | null {
  if (!centro.startsOn && !centro.endsOn) return null;
  const formatar = (dia: string) => DIA_CURTO.format(new Date(`${dia}T12:00:00Z`));
  if (centro.startsOn && centro.endsOn) {
    return `${formatar(centro.startsOn)} – ${formatar(centro.endsOn)}`;
  }
  return formatar((centro.startsOn ?? centro.endsOn) as string);
}

export function Indice({
  categorias,
  noAno,
  aberta,
  queryBase,
}: {
  categorias: CategoriaTotal[];
  noAno: CategoriaTotal[];
  aberta: string | null;
  /** Parametros da URL que precisam sobreviver ao clique (periodo, contas). */
  queryBase: string;
}) {
  if (categorias.length === 0) return null;

  const anoPorId = new Map(noAno.map((c) => [c.id, c]));
  const selecionada = categorias.find((c) => c.id === aberta) ?? categorias[0];

  const link = (id: string) =>
    `/categorias?${[queryBase, `cat=${encodeURIComponent(id)}`].filter(Boolean).join("&")}`;

  return (
    <section>
      <h2>Categorias</h2>

      <div className="cat-indice">
        {categorias.map((categoria) => {
          const ativa = categoria.id === selecionada.id;
          const ano = anoPorId.get(categoria.id);

          return (
            <Link
              key={categoria.id}
              href={link(categoria.id)}
              scroll={false}
              aria-current={ativa ? "true" : undefined}
              className={ativa ? "cat-bloco ativo" : "cat-bloco"}
              style={{ "--cat-h": categoria.hue } as React.CSSProperties}
            >
              {/* Circulos decorativos saindo pelo canto: dao peso ao bloco sem
                  competir com o texto. */}
              <span className="cat-bolha" aria-hidden />

              <span className="cat-topo">
                <IconeDeCategoria nome={categoria.name} tamanho={30} animar={ativa} />
                <span className="cat-nome">{categoria.name}</span>
                <span className="cat-badge">{categoria.centros.length}</span>
              </span>

              <span className="cat-rodape">
                {MES.format(categoria.sent)} / {ANO.format(ano?.sent ?? 0)}
              </span>
            </Link>
          );
        })}
      </div>

      <Painel categoria={selecionada} noAno={anoPorId.get(selecionada.id)} />
    </section>
  );
}

function Painel({
  categoria,
  noAno,
}: {
  categoria: CategoriaTotal;
  noAno: CategoriaTotal | undefined;
}) {
  const anoPorCentro = new Map((noAno?.centros ?? []).map((c) => [c.id, c]));
  // A barra compara dentro da categoria: a maior subcategoria do periodo e a
  // referencia. Comparar com o total do app faria toda categoria pequena virar
  // um tracinho.
  const maior = Math.max(1, ...categoria.centros.map((c) => c.sent));
  const lancamentosNoAno = (noAno?.centros ?? []).reduce((total, c) => total + c.count, 0);

  return (
    <div className="cat-painel" style={{ "--cat-h": categoria.hue } as React.CSSProperties}>
      <div className="cat-painel-topo">
        <span className="cat-painel-icone">
          <IconeDeCategoria nome={categoria.name} tamanho={34} animar />
        </span>
        <div>
          <div className="cat-painel-nome">{categoria.name}</div>
          <div className="account-meta">
            {categoria.centros.length}{" "}
            {categoria.centros.length === 1 ? "subcategoria" : "subcategorias"} ·{" "}
            {lancamentosNoAno} {lancamentosNoAno === 1 ? "lancamento" : "lancamentos"} no ano
          </div>
        </div>
        <div className="cat-painel-resumo">
          {MES.format(categoria.sent)} / {ANO.format(noAno?.sent ?? 0)}
        </div>
      </div>

      {categoria.centros.length === 0 ? (
        <p className="empty" style={{ marginTop: 16 }}>
          Nenhuma subcategoria ainda. Crie uma abaixo para separar o gasto desta categoria por
          viagem, por obra ou por pessoa.
        </p>
      ) : (
        <ul className="cat-linhas">
          {categoria.centros.map((centro) => {
            const ano = anoPorCentro.get(centro.id);
            const janela = periodo(centro);
            // Obra e viagem se medem pelo acumulado; o resto, pelo mes.
            const acumulado = Boolean(centro.startsOn || centro.endsOn);
            const gasto = acumulado ? (ano?.sent ?? centro.sent) : centro.sent;
            const usado = centro.budget ? gasto / centro.budget : 0;
            const estourou = usado > 1;

            return (
              <li key={centro.id} className="cat-linha">
                <div className="cat-linha-nome">
                  <span className="description">{centro.name}</span>
                  {janela ? <span className="tag">{janela}</span> : null}
                  <div className="account-meta">
                    {centro.count} {centro.count === 1 ? "lancamento" : "lancamentos"}
                  </div>
                </div>

                <div className="cat-linha-barra">
                  <div className="cat-trilho">
                    <div
                      className="cat-preenchimento"
                      style={{ width: `${Math.max(2, (centro.sent / maior) * 100)}%` }}
                    />
                  </div>
                  {centro.budget ? (
                    <div className={`account-meta ${estourou ? "negative" : ""}`}>
                      {ANO.format(centro.budget)} orcado{acumulado ? " (acumulado)" : ""} ·{" "}
                      {Math.round(usado * 100)}%{estourou ? " — estourou" : ""}
                    </div>
                  ) : null}
                </div>

                <div className="cat-linha-valores">
                  <span className="cat-valor-mes">{MES.format(centro.sent)}</span>
                  <span className="account-meta">{ANO.format(ano?.sent ?? 0)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {categoria.semCentro.count > 0 ? (
        <p className="cat-sem-centro">
          <strong>{MES.format(categoria.semCentro.sent)}</strong> em {categoria.semCentro.count}{" "}
          {categoria.semCentro.count === 1 ? "lancamento" : "lancamentos"} desta categoria sem
          subcategoria.
        </p>
      ) : null}
    </div>
  );
}
