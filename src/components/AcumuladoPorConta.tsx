import { diaCurto } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { DespesaPorConta } from "@/lib/finance/service";

/**
 * Quanto ja se gastou no mes, dia a dia, empilhado por conta.
 *
 * Acumulado, e nao gasto do dia: a pergunta e "a que altura do mes o dinheiro
 * foi", e para isso a linha que so sobe responde melhor que um serrilhado. A
 * pilha responde a segunda pergunta junto — de que conta saiu.
 *
 * A cor identifica a conta, entao ela e a unica coisa que carrega identidade
 * dentro da area. Duas exigencias vem dai: a legenda esta sempre presente, e a
 * ORDEM das faixas nao e a do valor — matizes parecidas ficam separadas na
 * pilha, porque encostadas elas somem uma na outra. Quem decide a ordem e
 * `ordenarParaContraste`, no servico.
 */

const ALTURA = 200;
const TOPO = 14;
/** Espaco a esquerda para os rotulos do eixo de valor. */
const ESQUERDA = 58;
const BAIXO = 22;

const COMPACTO = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

export function AcumuladoPorConta({
  contas,
  acumulado,
}: {
  contas: DespesaPorConta[];
  acumulado: { dia: string; porConta: Record<string, number> }[];
}) {
  if (contas.length === 0 || acumulado.length === 0) return null;

  const largura = 720;
  const plotW = largura - ESQUERDA - 8;
  const plotH = ALTURA - TOPO - BAIXO;

  const teto = Math.max(
    1,
    ...acumulado.map((ponto) => contas.reduce((s, c) => s + (ponto.porConta[c.id] ?? 0), 0)),
  );

  const x = (i: number) =>
    ESQUERDA + (acumulado.length === 1 ? plotW / 2 : (i / (acumulado.length - 1)) * plotW);
  const y = (valor: number) => TOPO + plotH - (valor / teto) * plotH;

  // Cada faixa e a area entre o acumulado ate a conta anterior e o dela: e o que
  // faz a pilha somar exatamente o total, sem sobreposicao nem folga.
  const faixas = contas.map((conta, indice) => {
    const abaixo = contas.slice(0, indice);
    const base = acumulado.map((p) => abaixo.reduce((s, c) => s + (p.porConta[c.id] ?? 0), 0));
    const topo = base.map((v, i) => v + (acumulado[i].porConta[conta.id] ?? 0));

    const subida = topo.map((v, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(v)}`).join(" ");
    const descida = base
      .map((v, i) => `L${x(base.length - 1 - i)},${y(base[base.length - 1 - i])}`)
      .join(" ");

    return { conta, d: `${subida} ${descida} Z`, topoFinal: topo[topo.length - 1] };
  });

  const marcas = [0, 0.5, 1].map((f) => teto * f);
  const passo = Math.max(1, Math.ceil(acumulado.length / 6));

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Gasto acumulado no periodo · <strong>{formatBRL(teto)}</strong> ate{" "}
        {diaCurto(acumulado[acumulado.length - 1].dia)}
      </figcaption>

      <div className="gr-plot">
        <svg viewBox={`0 0 ${largura} ${ALTURA}`} role="img" aria-label="Gasto acumulado por conta">
          {marcas.map((valor) => (
            <g key={valor}>
              <line
                x1={ESQUERDA}
                x2={largura - 8}
                y1={y(valor)}
                y2={y(valor)}
                className="gr-grade"
              />
              <text x={ESQUERDA - 8} y={y(valor) + 4} className="gr-eixo" textAnchor="end">
                {valor === 0 ? "0" : COMPACTO.format(valor)}
              </text>
            </g>
          ))}

          {faixas.map(({ conta, d }) => (
            <path key={conta.id} d={d} fill={conta.cor} className="gr-faixa">
              <title>{`${conta.nome} · ${formatBRL(conta.total)}`}</title>
            </path>
          ))}

          {acumulado.map((ponto, i) =>
            i % passo === 0 || i === acumulado.length - 1 ? (
              <text
                key={ponto.dia}
                x={x(i)}
                y={ALTURA - 6}
                className="gr-eixo"
                // As pontas ancoram para dentro: centrado, o rotulo do ultimo
                // dia fica metade fora do quadro e aparece cortado.
                textAnchor={i === 0 ? "start" : i === acumulado.length - 1 ? "end" : "middle"}
              >
                {diaCurto(ponto.dia)}
              </text>
            ) : null,
          )}
        </svg>
      </div>

      {/* A legenda nao e opcional: dentro da area so a cor diz de quem e a faixa. */}
      <ul className="gr-legenda">
        {contas.map((conta) => (
          <li key={conta.id}>
            <span className="gr-marca" style={{ background: conta.cor }} aria-hidden />
            {conta.nome}
          </li>
        ))}
      </ul>
    </figure>
  );
}
