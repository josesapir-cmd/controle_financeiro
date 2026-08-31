import type { CategoriaTotal } from "@/lib/finance/centros";
import { formatBRL } from "@/lib/finance/money";
import { recuar, squarify, type Retangulo } from "@/lib/finance/treemap";

/**
 * Treemap de categorias e centros de custo.
 *
 * A area responde "quanto"; o rotulo dentro do bloco responde "o que". A cor
 * NAO carrega identidade — carrega magnitude, num unico tom de azul, mais
 * escuro quanto maior a fatia.
 *
 * Isso e deliberado. Dar um matiz a cada categoria pareceria mais bonito e
 * seria pior: sao 16 categorias, e nenhuma paleta separa 16 matizes de forma
 * confiavel para quem nao distingue cores — num treemap qualquer bloco pode
 * encostar em qualquer outro, entao o problema e ainda maior do que numa barra
 * empilhada. Com um tom so, a identidade fica onde ela e exata: escrita dentro
 * do bloco, e na tabela logo abaixo.
 *
 * A rampa foi validada (monotonica, degraus visiveis, ponta clara acima de 2:1
 * sobre branco) e cada degrau tem tinta de rotulo com contraste de no minimo
 * 6,2:1.
 *
 * Receita e movimentacao ficam de fora do mapa: nao dividem o mesmo bolo que a
 * despesa, e dar-lhes area no mesmo retangulo afirmaria que dividem.
 */

/** Degraus do azul, do maior para o menor, com a tinta legivel de cada um. */
const DEGRAUS = [
  { fundo: "#104281", tinta: "#ffffff" },
  { fundo: "#1c5cab", tinta: "#ffffff" },
  { fundo: "#5598e7", tinta: "#0e121b" },
  { fundo: "#86b6ef", tinta: "#0e121b" },
] as const;

/** Cinza para o que nao e centro de custo: nao e uma fatia da mesma natureza. */
const NAO_CLASSIFICADO = { fundo: "#e1e4ea", tinta: "#525866" };

/**
 * Degrau pela fatia do total, nao pela posicao na lista.
 *
 * Por posicao, o quinto maior gasto ficaria claro mesmo valendo quase tanto
 * quanto o quarto; a cor passaria a codificar ranking, que nao e o dado.
 */
function degrau(fracao: number) {
  if (fracao >= 0.2) return DEGRAUS[0];
  if (fracao >= 0.08) return DEGRAUS[1];
  if (fracao >= 0.03) return DEGRAUS[2];
  return DEGRAUS[3];
}

/** Espaco entre blocos, em unidades da caixa (100 x 100). */
const RESPIRO = 0.35;

interface Folha {
  id: string;
  nome: string;
  categoria: string;
  valor: number;
  classificado: boolean;
}

function porcentagem(valor: number): string {
  return `${valor}%`;
}

export function TreemapCategorias({
  categorias,
  total,
}: {
  categorias: CategoriaTotal[];
  /** Total de saida do periodo, para calcular a fatia de cada bloco. */
  total: number;
}) {
  // So despesa entra: receita e movimentacao nao dividem o mesmo bolo, e
  // soma-las na mesma area diria que sao a mesma coisa.
  const despesas = categorias.filter((c) => c.kind === "despesa" && c.sent > 0);

  if (despesas.length === 0 || total <= 0) {
    return (
      <p className="empty">
        Nenhuma despesa classificada no periodo. O mapa aparece quando houver o que dividir.
      </p>
    );
  }

  const blocos = squarify(
    despesas.map((c) => ({ id: c.id, valor: c.sent })),
    100,
    100,
  );

  const porId = new Map(despesas.map((c) => [c.id, c]));

  return (
    <figure className="treemap-figura">
      <div className="treemap" role="img" aria-label={`Mapa de ${formatBRL(-total)} em despesas por categoria e centro de custo. Os valores estao na tabela abaixo.`}>
        {blocos.map((bloco) => {
          const categoria = porId.get(bloco.id);
          if (!categoria) return null;

          const area = recuar(bloco, RESPIRO);
          const fracao = categoria.sent / total;

          // Folhas da categoria: cada centro com gasto, mais o que ficou sem
          // centro — que aparece em cinza, como pendencia, nao como fatia.
          const folhas: Folha[] = [
            ...categoria.centros
              .filter((centro) => centro.sent > 0)
              .map((centro) => ({
                id: centro.id,
                nome: centro.name,
                categoria: categoria.name,
                valor: centro.sent,
                classificado: true,
              })),
            ...(categoria.semCentro.sent > 0
              ? [
                  {
                    id: `${categoria.id}-sem`,
                    nome: "Sem centro de custo",
                    categoria: categoria.name,
                    valor: categoria.semCentro.sent,
                    classificado: false,
                  },
                ]
              : []),
          ];

          // Bloco pequeno demais nao comporta subdivisao legivel: subdividir ali
          // produz tiras de dois pixels sem rotulo, que nao informam nada.
          const cabeSubdividir = folhas.length > 1 && area.w > 14 && area.h > 12;
          const cor = degrau(fracao);

          return (
            <div
              key={bloco.id}
              className="treemap-categoria"
              style={{
                left: porcentagem(area.x),
                top: porcentagem(area.y),
                width: porcentagem(area.w),
                height: porcentagem(area.h),
              }}
            >
              {cabeSubdividir ? (
                <>
                  {/* O nome da categoria e uma faixa DENTRO do grupo, nao um
                      rotulo flutuando acima dele: solto, ele caia por cima do
                      bloco vizinho de cima. */}
                  <span className="treemap-cabecalho">
                    <span className="treemap-grupo-nome">{categoria.name}</span>
                    <span className="treemap-grupo-valor">{formatBRL(-categoria.sent)}</span>
                  </span>
                  <div className="treemap-grupo">
                    <SubBlocos folhas={folhas} area={area} total={total} />
                  </div>
                </>
              ) : (
                <div
                  className="treemap-bloco"
                  style={{ background: cor.fundo, color: cor.tinta }}
                  title={`${categoria.name} · ${formatBRL(-categoria.sent)} · ${Math.round(fracao * 100)}% das despesas`}
                >
                  <Rotulo nome={categoria.name} valor={categoria.sent} fracao={fracao} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      <figcaption className="account-meta">
        Area proporcional ao gasto. O tom escurece com a fatia do total — a cor nao identifica
        categoria, o rotulo identifica. Em cinza, o gasto da categoria ainda sem centro de custo.
      </figcaption>
    </figure>
  );
}

/** Subdivisao de uma categoria nos seus centros de custo. */
function SubBlocos({
  folhas,
  area,
  total,
}: {
  folhas: Folha[];
  area: Retangulo;
  total: number;
}) {
  const dentro = squarify(
    folhas.map((f) => ({ id: f.id, valor: f.valor })),
    area.w,
    area.h,
  );
  const porId = new Map(folhas.map((f) => [f.id, f]));

  // O respiro interno e proporcional ao bloco, para nao comer uma categoria
  // pequena inteira.
  const margem = Math.min(RESPIRO, area.w / 40, area.h / 40);

  return (
    <>
      {dentro.map((sub) => {
        const folha = porId.get(sub.id);
        if (!folha) return null;

        const caixa = recuar(sub, margem);
        const fracao = folha.valor / total;
        const cor = folha.classificado ? degrau(fracao) : NAO_CLASSIFICADO;

        return (
          <div
            key={sub.id}
            className="treemap-bloco treemap-filho"
            style={{
              left: porcentagem((caixa.x / area.w) * 100),
              top: porcentagem((caixa.y / area.h) * 100),
              width: porcentagem((caixa.w / area.w) * 100),
              height: porcentagem((caixa.h / area.h) * 100),
              background: cor.fundo,
              color: cor.tinta,
            }}
            title={`${folha.categoria} › ${folha.nome} · ${formatBRL(-folha.valor)} · ${Math.round(fracao * 100)}% das despesas`}
          >
            <Rotulo nome={folha.nome} valor={folha.valor} fracao={fracao} />
          </div>
        );
      })}
    </>
  );
}

/**
 * Rotulo dentro do bloco.
 *
 * Nome, valor e fatia saem sempre na marcacao; QUEM DECIDE o que aparece e o
 * CSS, por consulta de container — o bloco mede a si mesmo em pixels.
 *
 * A primeira versao decidia aqui, comparando as unidades abstratas da caixa
 * (0-100). Nao funciona: os mesmos 12% viram 90px no computador e 45px no
 * celular, entao o rotulo cabia num lugar e vazava no outro.
 */
function Rotulo({ nome, valor, fracao }: { nome: string; valor: number; fracao: number }) {
  return (
    <span className="treemap-rotulo">
      <span className="treemap-nome">{nome}</span>
      <span className="treemap-valor">{formatBRL(-valor)}</span>
      <span className="treemap-fatia">{Math.round(fracao * 100)}%</span>
    </span>
  );
}
