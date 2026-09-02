"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";
import { PREENCHIMENTO, POR_VOLTA, SETA, direcaoDasTeclas, type Direcao } from "./bussola";
import { filtrarSubcategorias } from "./subcategorias";

/**
 * Classificar no teclado, uma despesa por vez.
 *
 * A lista da aba Dia e boa para conferir e ruim para despachar: cada gasto exige
 * mirar o cursor num bloco. Aqui a despesa fica no centro e as categorias em
 * volta, sempre nos mesmos lugares — depois de algumas, a mao sabe onde fica
 * cada uma e a tela vira so confirmacao.
 *
 * As oito direcoes saem de quatro teclas. Seta sozinha aponta para o lado;
 * duas juntas apontam para a diagonal, como em jogo. Nao ha tecla de diagonal
 * num teclado, e inventar atalho de letra para elas perderia justamente o que
 * faz isto funcionar: a posicao na tela ser a posicao na mao.
 */

/** Duracao do voo do cartao ate a categoria, em ms. */
const VOO = 420;

/** O cartao em voo: de onde saiu e para onde vai, ja em pixels de tela. */
interface Voo {
  chave: number;
  x: number;
  y: number;
  largura: number;
  altura: number;
  dx: number;
  dy: number;
  escala: number;
  hue: number;
  descricao: string;
  valor: number;
}

interface Props {
  lancamentos: LancamentoParaClassificar[];
  categorias: CategoriaParaClassificar[];
  onClassificar: (
    lancamento: LancamentoParaClassificar,
    categoriaId: string,
    subcategoria?: string,
  ) => void;
  onFechar: () => void;
}

export function ModoJogo({ lancamentos, categorias, onClassificar, onFechar }: Props) {
  const [indice, setIndice] = useState(0);
  const [direcao, setDirecao] = useState<Direcao | null>(null);
  const [pagina, setPagina] = useState(0);
  /**
   * Ja despachados nesta sessao.
   *
   * A gravacao e uma transicao no servidor: esperar a lista encolher deixaria a
   * mesma despesa na tela por um instante depois do enter, e um enter repetido
   * nesse instante classificaria a mesma coisa duas vezes. Guardar aqui faz a
   * proxima aparecer no mesmo quadro.
   */
  const [despachados, setDespachados] = useState<ReadonlySet<string>>(new Set());
  /** Texto digitado no campo de subcategoria. `null` quando ele esta fechado. */
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  const [sugestao, setSugestao] = useState(0);
  const [voo, setVoo] = useState<Voo | null>(null);
  /** Painel com tudo o que se sabe da despesa, aberto pela tecla `i`. */
  const [informando, setInformando] = useState(false);
  /** Categoria que acabou de receber um cartao, para o baque de chegada. */
  const [recebeu, setRecebeu] = useState<Direcao | null>(null);

  /** Setas pressionadas neste instante, para reconhecer a diagonal. */
  const teclas = useRef(new Set<string>());
  const caixa = useRef<HTMLDivElement>(null);
  const centro = useRef<HTMLDivElement>(null);
  const alvos = useRef(new Map<Direcao, HTMLElement>());
  const campo = useRef<HTMLInputElement>(null);

  /**
   * A bussola e fixa durante a sessao inteira.
   *
   * A ordem sai do quanto cada categoria ja foi usada no mes, calculada UMA vez:
   * reordenar a cada despesa jogaria fora a memoria muscular, que e a unica
   * razao de isto ser mais rapido que arrastar.
   */
  const bussola = useMemo(
    () => [...categorias].sort((a, b) => b.noMes - a.noMes || a.name.localeCompare(b.name, "pt-BR")),
    [categorias],
  );

  const paginas = Math.max(1, Math.ceil(bussola.length / POR_VOLTA));
  const daVolta = bussola.slice(pagina * POR_VOLTA, pagina * POR_VOLTA + POR_VOLTA);

  const porDirecao = new Map<Direcao, CategoriaParaClassificar>();
  daVolta.forEach((categoria, i) => porDirecao.set(PREENCHIMENTO[i], categoria));

  const fila = lancamentos.filter((l) => !despachados.has(l.id));
  // O indice da a volta: quem foi pulado reaparece no fim, em vez de sumir.
  const atual = fila.length ? fila[indice % fila.length] : undefined;
  const escolhida = direcao ? porDirecao.get(direcao) : undefined;

  const opcoes = escolhida ? filtrarSubcategorias(escolhida.centros, subcategoria ?? "") : [];

  // Foco na caixa: sem ele as setas rolariam a pagina de fundo em vez de mirar.
  useEffect(() => {
    caixa.current?.focus();
  }, []);

  useEffect(() => {
    if (subcategoria !== null) campo.current?.focus();
  }, [subcategoria !== null]);

  function limparMira() {
    setDirecao(null);
    setSubcategoria(null);
    // O painel e sobre AQUELA despesa: deixa-lo aberto mostraria os dados de
    // uma e o cartao de outra.
    setInformando(false);
    teclas.current.clear();
  }

  /** Pular: a despesa continua na fila e volta depois de todas as outras. */
  function avancar() {
    limparMira();
    setIndice((i) => i + 1);
  }

  /**
   * Manda o cartao para a celula da categoria.
   *
   * Medido na hora do clique, e nao guardado: a grade muda de tamanho com a
   * janela, e uma posicao velha jogaria o cartao para fora da tela.
   */
  function levantarVoo(lancamento: LancamentoParaClassificar, alvo: Direcao, hue: number) {
    const daOrigem = centro.current?.getBoundingClientRect();
    const doDestino = alvos.current.get(alvo)?.getBoundingClientRect();
    if (!daOrigem || !doDestino) return;

    setVoo({
      chave: Date.now(),
      x: daOrigem.left,
      y: daOrigem.top,
      largura: daOrigem.width,
      altura: daOrigem.height,
      dx: doDestino.left + doDestino.width / 2 - (daOrigem.left + daOrigem.width / 2),
      dy: doDestino.top + doDestino.height / 2 - (daOrigem.top + daOrigem.height / 2),
      escala: Math.min(doDestino.width / daOrigem.width, doDestino.height / daOrigem.height),
      hue,
      descricao: lancamento.descricao,
      valor: lancamento.valor,
    });

    setRecebeu(alvo);
    window.setTimeout(() => setVoo(null), VOO);
    window.setTimeout(() => setRecebeu(null), VOO + 180);
  }

  function classificar() {
    if (!atual || !escolhida || !direcao) return;

    levantarVoo(atual, direcao, escolhida.hue);
    onClassificar(atual, escolhida.id, subcategoria ?? undefined);
    setDespachados((atuais) => new Set(atuais).add(atual.id));
    limparMira();
    // Sem mexer no indice: a despesa sai da fila e a seguinte assume o lugar.
    // Avancar tambem pularia uma.
  }

  useEffect(() => {
    function baixou(evento: KeyboardEvent) {
      // Com o campo aberto o teclado e dele: as setas escolhem sugestao, e nao
      // categoria. Quem trata isso e o proprio campo.
      if (subcategoria !== null) return;

      if (evento.key === "Escape") {
        onFechar();
        return;
      }

      if (evento.key.startsWith("Arrow")) {
        evento.preventDefault();
        if (evento.repeat) return;
        teclas.current.add(evento.key);
        const apontada = direcaoDasTeclas(teclas.current);
        if (apontada) setDirecao(apontada);
        return;
      }

      if (evento.key === "Enter") {
        evento.preventDefault();
        classificar();
        return;
      }

      // Espaco abre a subcategoria da categoria mirada. Sem mira nao ha lista
      // de onde escolher, entao nao ha o que abrir.
      if (evento.key === " ") {
        evento.preventDefault();
        if (escolhida) {
          setSugestao(0);
          setSubcategoria("");
        }
        return;
      }

      if (evento.key === "Backspace") {
        evento.preventDefault();
        avancar();
        return;
      }

      // `i` de informacao: quando "AMAZON BR" nao diz se foi livro ou fone, o
      // que decide esta no meio de pagamento, no documento ou no produto.
      if (evento.key === "i" || evento.key === "I") {
        evento.preventDefault();
        setInformando((aberto) => !aberto);
        return;
      }

      if (evento.key === "Tab" && paginas > 1) {
        evento.preventDefault();
        setDirecao(null);
        setPagina((p) => (p + 1) % paginas);
      }
    }

    function soltou(evento: KeyboardEvent) {
      teclas.current.delete(evento.key);
    }

    // Sem lista de dependencias de proposito: os ouvintes sao trocados a cada
    // render para enxergarem o estado atual. Registrar uma vez exigiria refs
    // para tudo que eles leem, o que e mais codigo para o mesmo efeito.
    //
    // Na janela inteira, e nao na caixa: uma tecla solta fora dela deixaria a
    // seta presa no conjunto e travaria a diagonal para sempre.
    window.addEventListener("keydown", baixou);
    window.addEventListener("keyup", soltou);
    return () => {
      window.removeEventListener("keydown", baixou);
      window.removeEventListener("keyup", soltou);
    };
  });

  /** Teclas do campo de subcategoria, enquanto ele esta aberto. */
  function noCampo(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      evento.preventDefault();
      setSubcategoria(null);
      caixa.current?.focus();
      return;
    }

    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (opcoes.length === 0) return;
      const passo = evento.key === "ArrowDown" ? 1 : -1;
      setSugestao((i) => (i + passo + opcoes.length) % opcoes.length);
      return;
    }

    if (evento.key === "Enter") {
      evento.preventDefault();
      // A sugestao marcada vence o texto cru: quem desceu a seta ate ela quis
      // aquela, e nao criar outra com o nome pela metade.
      const escolha = opcoes[sugestao] ?? subcategoria ?? "";
      setSubcategoria(escolha);
      // Um quadro depois, com o texto ja no estado, a classificacao acontece.
      window.setTimeout(() => {
        if (!atual || !escolhida || !direcao) return;
        levantarVoo(atual, direcao, escolhida.hue);
        onClassificar(atual, escolhida.id, escolha || undefined);
        setDespachados((atuais) => new Set(atuais).add(atual.id));
        limparMira();
        caixa.current?.focus();
      }, 0);
    }
  }

  const restam = fila.length;

  return (
    <div className="jogo-fundo" role="dialog" aria-modal="true" aria-label="Classificar no teclado">
      {voo ? (
        <div
          key={voo.chave}
          className="jogo-voo"
          aria-hidden
          style={
            {
              left: voo.x,
              top: voo.y,
              width: voo.largura,
              height: voo.altura,
              "--cat-h": voo.hue,
              "--voo-dx": `${voo.dx}px`,
              "--voo-dy": `${voo.dy}px`,
              "--voo-s": voo.escala,
              "--voo-ms": `${VOO}ms`,
            } as React.CSSProperties
          }
        >
          <span className="jogo-desc">{voo.descricao}</span>
          <span className="jogo-valor">{formatBRL(voo.valor)}</span>
        </div>
      ) : null}

      <div className="jogo" ref={caixa} tabIndex={-1}>
        <div className="jogo-topo">
          <span className="jogo-contador">
            {restam} {restam === 1 ? "despesa" : "despesas"} sem categoria
          </span>
          <button type="button" className="jogo-sair" onClick={onFechar}>
            sair (esc)
          </button>
        </div>

        {!atual ? (
          <div className="jogo-fim">
            <strong>Acabou.</strong>
            <span className="account-meta">Nenhuma despesa deste dia esta sem categoria.</span>
            <button type="button" onClick={onFechar}>
              Fechar
            </button>
          </div>
        ) : (
          <>
            <div className="jogo-grade">
              {PREENCHIMENTO.map((posicao) => {
                const categoria = porDirecao.get(posicao);
                if (!categoria) return <span key={posicao} className={`jogo-vazio jogo-${posicao}`} />;

                const acesa = direcao === posicao;

                return (
                  <button
                    type="button"
                    key={posicao}
                    ref={(elemento) => {
                      if (elemento) alvos.current.set(posicao, elemento);
                      else alvos.current.delete(posicao);
                    }}
                    className={[
                      "jogo-alvo",
                      `jogo-${posicao}`,
                      acesa ? "aceso" : "",
                      recebeu === posicao ? "recebeu" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    style={{ "--cat-h": categoria.hue } as React.CSSProperties}
                    aria-pressed={acesa}
                    onClick={() => setDirecao(posicao)}
                  >
                    <IconeDeCategoria nome={categoria.name} tamanho={26} animar={acesa} />
                    <span className="jogo-nome">{categoria.name}</span>
                    <span className="jogo-seta" aria-hidden>
                      {SETA[posicao]}
                    </span>
                  </button>
                );
              })}

              <div
                ref={centro}
                className="jogo-centro"
                style={
                  escolhida ? ({ "--cat-h": escolhida.hue } as React.CSSProperties) : undefined
                }
              >
                <span className="jogo-hora">{atual.hora}</span>
                <span className="jogo-desc">{atual.descricao}</span>
                <span className="jogo-valor">{formatBRL(atual.valor)}</span>
                <span className="account-meta">
                  {[atual.contraparte, atual.conta].filter(Boolean).join(" · ")}
                </span>

                {subcategoria !== null && escolhida ? (
                  <div className="jogo-sub">
                    <input
                      ref={campo}
                      type="text"
                      value={subcategoria}
                      placeholder={`subcategoria de ${escolhida.name}`}
                      aria-label={`Subcategoria de ${escolhida.name}`}
                      onChange={(evento) => {
                        setSubcategoria(evento.target.value);
                        setSugestao(0);
                      }}
                      onKeyDown={noCampo}
                    />

                    {opcoes.length > 0 ? (
                      <ul className="jogo-sugestoes">
                        {opcoes.map((nome, i) => (
                          <li key={nome}>
                            <button
                              type="button"
                              className={i === sugestao ? "marcada" : ""}
                              onMouseEnter={() => setSugestao(i)}
                              onClick={() => setSubcategoria(nome)}
                            >
                              {nome}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}

                    <span className="account-meta">
                      {opcoes.length > 0
                        ? "setas escolhem · enter classifica · esc volta"
                        : subcategoria.trim()
                          ? `enter cria "${subcategoria.trim()}"`
                          : "digite ou deixe em branco · esc volta"}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="jogo-confirmar"
                    disabled={!escolhida}
                    onClick={classificar}
                  >
                    {escolhida ? `${escolhida.name} · enter` : "escolha uma direcao"}
                  </button>
                )}
              </div>
            </div>

            {/* Fora da celula do meio de proposito: no terco central o rotulo e
                o valor quebravam em duas linhas cada. Aqui a largura e a da
                modal, e nada disso e escolha — e o que ajuda a decidir. */}
            {informando ? (
              <dl className="jogo-info">
                {atual.detalhes.length === 0 ? (
                  <p className="account-meta" style={{ gridColumn: "1 / -1", margin: 0 }}>
                    E tudo o que temos: o banco nao mandou mais nada deste lancamento.
                  </p>
                ) : (
                  atual.detalhes.map((detalhe) => (
                    <div key={`${detalhe.label}-${detalhe.value}`}>
                      <dt>{detalhe.label}</dt>
                      <dd>{detalhe.value}</dd>
                    </div>
                  ))
                )}
              </dl>
            ) : null}

            <div className="jogo-rodape">
              <span className="account-meta">
                setas miram · duas juntas fazem a diagonal · enter classifica · espaco abre a
                subcategoria · i mostra o que se sabe · backspace pula
                {paginas > 1 ? ` · tab troca de volta (${pagina + 1}/${paginas})` : ""}
              </span>
              <button type="button" className="jogo-pular" onClick={avancar}>
                pular
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
