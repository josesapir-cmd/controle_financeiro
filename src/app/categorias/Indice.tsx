"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import type { CategoriaTotal, CentroTotal } from "@/lib/finance/centros";
import { adicionarCentro } from "./actions";

/**
 * Indice de categorias em blocos de cor, com as subcategorias da categoria
 * aberta logo abaixo.
 *
 * Os blocos crescem com a aproximacao do ponteiro, como o dock do celular na
 * aba Dia — mesma formula, so que a distancia aqui e nas duas dimensoes, porque
 * isto e uma grade e nao uma fila. O bloco aberto fica grande o tempo todo: a
 * selecao precisa se ver mesmo com o ponteiro longe.
 *
 * A selecao mora na URL (`?cat=`): a tela continua sendo renderizada no
 * servidor, o botao voltar funciona e o link e compartilhavel.
 */

/** Numero grande sem simbolo nem sinal: tudo no bloco e despesa. */
const MES = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const ANO = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });

const DIA_CURTO = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short" });

/** Distancia em que a ampliacao ja acabou, e quanto ela cresce no centro. */
const ALCANCE = 150;
const AUMENTO = 0.22;
/** O bloco aberto fica ampliado sem ponteiro nenhum. */
const ABERTO = 1.1;

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
  const grade = useRef<HTMLDivElement>(null);
  const blocos = useRef(new Map<string, HTMLElement>());
  const [ponteiro, setPonteiro] = useState<{ x: number; y: number } | null>(null);

  if (categorias.length === 0) return null;

  const anoPorId = new Map(noAno.map((c) => [c.id, c]));
  const selecionada = categorias.find((c) => c.id === aberta) ?? categorias[0];

  const link = (id: string) =>
    `/categorias?${[queryBase, `cat=${encodeURIComponent(id)}`].filter(Boolean).join("&")}`;

  /**
   * Escala pela distancia do ponteiro ao centro do bloco.
   *
   * A ampliacao e por `transform`, entao crescer nao empurra os vizinhos — o
   * alvo nao foge de baixo do cursor enquanto ele se aproxima.
   */
  function escala(id: string, ativa: boolean): number {
    const base = ativa ? ABERTO : 1;
    if (!ponteiro) return base;

    const elemento = blocos.current.get(id);
    if (!elemento) return base;

    const caixa = elemento.getBoundingClientRect();
    const dx = ponteiro.x - (caixa.left + caixa.width / 2);
    const dy = ponteiro.y - (caixa.top + caixa.height / 2);
    const distancia = Math.hypot(dx, dy);

    return base + AUMENTO * Math.exp(-((distancia / ALCANCE) ** 2));
  }

  return (
    <section>
      <h2>Categorias</h2>

      <div
        ref={grade}
        className="cat-indice"
        // So o mouse amplia: no toque nao existe "passar por cima", e ampliar
        // no primeiro contato faria o alvo se mexer debaixo do dedo.
        onPointerMove={(evento) => {
          if (evento.pointerType !== "mouse") return;
          setPonteiro({ x: evento.clientX, y: evento.clientY });
        }}
        onPointerLeave={() => setPonteiro(null)}
      >
        {categorias.map((categoria) => {
          const ativa = categoria.id === selecionada.id;
          const ano = anoPorId.get(categoria.id);
          const s = escala(categoria.id, ativa);

          return (
            <Link
              key={categoria.id}
              ref={(elemento) => {
                if (elemento) blocos.current.set(categoria.id, elemento);
                else blocos.current.delete(categoria.id);
              }}
              href={link(categoria.id)}
              scroll={false}
              aria-current={ativa ? "true" : undefined}
              className={ativa ? "cat-bloco ativo" : "cat-bloco"}
              title={categoria.hint ?? undefined}
              style={
                {
                  "--cat-h": categoria.hue,
                  transform: `scale(${s.toFixed(3)})`,
                  // Quem cresce passa por cima; o aberto ganha do vizinho
                  // ampliado de passagem.
                  zIndex: ativa ? 3 : s > 1.02 ? 2 : 1,
                } as React.CSSProperties
              }
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
  const [criando, setCriando] = useState(false);
  const anoPorCentro = new Map((noAno?.centros ?? []).map((c) => [c.id, c]));
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
          {/* O que entra aqui, escrito. E onde mora a regra de borda — que
              restaurante vai em Lazer, nao em Alimentacao. */}
          {categoria.hint ? <div className="cat-dica">{categoria.hint}</div> : null}
        </div>
        <div className="cat-painel-resumo">
          {MES.format(categoria.sent)} / {ANO.format(noAno?.sent ?? 0)}
        </div>
      </div>

      <div className="cat-quadrados">
        {categoria.centros.map((centro) => {
          const ano = anoPorCentro.get(centro.id);
          const janela = periodo(centro);
          // Obra e viagem se medem pelo acumulado; o resto, pelo mes.
          const acumulado = Boolean(centro.startsOn || centro.endsOn);
          const gasto = acumulado ? (ano?.sent ?? centro.sent) : centro.sent;
          const usado = centro.budget ? gasto / centro.budget : 0;
          const estourou = usado > 1;

          return (
            <div key={centro.id} className="sub-quadrado">
              <span className="sub-nome">{centro.name}</span>
              <span className="sub-valor">{MES.format(centro.sent)}</span>
              <span className="sub-meta">
                {janela ??
                  `${centro.count} ${centro.count === 1 ? "lancamento" : "lancamentos"}`}
              </span>

              {/* O orcamento vira uma faixa no pe do quadrado: perder o dado
                  para caber no desenho seria trocar informacao por enfeite. */}
              {centro.budget ? (
                <span className="sub-orcamento" title={`${Math.round(usado * 100)}% de ${ANO.format(centro.budget)}`}>
                  <span
                    className={estourou ? "sub-orcamento-uso estourado" : "sub-orcamento-uso"}
                    style={{ width: `${Math.min(usado, 1) * 100}%` }}
                  />
                </span>
              ) : null}
            </div>
          );
        })}

        {criando ? (
          <form action={adicionarCentro} className="sub-quadrado sub-novo-aberto">
            <input type="hidden" name="categoryId" value={categoria.id} />
            <input
              type="text"
              name="name"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              placeholder="nome"
              aria-label={`Nova subcategoria de ${categoria.name}`}
              onKeyDown={(evento) => {
                if (evento.key === "Escape") setCriando(false);
              }}
            />
            <button type="submit">Criar</button>
          </form>
        ) : (
          <button
            type="button"
            className="sub-quadrado sub-novo"
            onClick={() => setCriando(true)}
            aria-label={`Nova subcategoria de ${categoria.name}`}
          >
            <span aria-hidden>+</span>
          </button>
        )}
      </div>

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
