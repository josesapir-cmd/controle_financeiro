"use client";

import { useEffect, useRef, useState } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";
import type { SituacaoDoDia } from "@/lib/finance/situacao";
import { PREENCHIMENTO, POR_VOLTA, SETA, direcaoDasTeclas, type Direcao } from "./bussola";
import { SpinnerDeDatas } from "./SpinnerDeDatas";
import { completarSubcategoria, filtrarSubcategorias } from "./subcategorias";

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

const DIA_EXTENSO = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: "UTC",
});

/**
 * "Segunda-feira, 2 de setembro".
 *
 * Meio-dia UTC e fuso fixo: o rotulo nao pode cair no dia anterior por causa da
 * hora em que a pagina foi aberta.
 */
function diaPorExtenso(dia: string): string {
  const texto = DIA_EXTENSO.format(new Date(`${dia}T12:00:00Z`));
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

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
  /** Dia da tela: e de onde a fita de datas parte quando a fila acaba. */
  dia: string;
  situacoes: Record<string, SituacaoDoDia>;
  /** O que precisa sobreviver a troca de dia, `jogo=1` incluso. */
  queryExtra: string;
  onClassificar: (
    lancamento: LancamentoParaClassificar,
    categoriaId: string,
    opcoes?: {
      subcategoria?: string;
      /** Vale para toda a contraparte, e nao so para este lancamento. */
      aContraparteToda?: boolean;
      comentario?: string;
    },
  ) => void;
  /** Grava so o comentario, sem tocar na categoria. */
  onComentar: (lancamento: LancamentoParaClassificar, comentario: string) => void;
  onFechar: () => void;
}

export function ModoJogo({
  lancamentos,
  categorias,
  dia,
  situacoes,
  queryExtra,
  onClassificar,
  onComentar,
  onFechar,
}: Props) {
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
  /** Valor do campo de subcategoria. `null` quando ele esta fechado. */
  const [subcategoria, setSubcategoria] = useState<string | null>(null);
  /**
   * O que a pessoa realmente digitou, sem a parte que o campo completou.
   *
   * Filtrar pelo valor do campo faria o completado virar entrada na tecla
   * seguinte, e a lista de alternativas encolheria para uma so.
   */
  const [digitado, setDigitado] = useState("");
  const [sugestao, setSugestao] = useState(0);
  /** Trecho a selecionar depois do render, para o completado sair na proxima tecla. */
  const selecao = useRef<[number, number] | null>(null);
  const [voo, setVoo] = useState<Voo | null>(null);
  /** Painel com tudo o que se sabe da despesa, aberto pela tecla `i`. */
  const [informando, setInformando] = useState(false);
  /** Categoria que acabou de receber um cartao, para o baque de chegada. */
  const [recebeu, setRecebeu] = useState<Direcao | null>(null);
  /** Recado de uma classificacao que passou de um lancamento so. */
  const [aviso, setAviso] = useState<string | null>(null);
  /**
   * Comentario em edicao. `null` com a caixa fechada.
   *
   * O texto sobrevive ao fechar a caixa e viaja junto com a classificacao: quem
   * escreve o comentario antes de escolher a categoria nao devia perde-lo por
   * ter apertado esc.
   */
  const [comentario, setComentario] = useState<string | null>(null);
  const [comentarioPendente, setComentarioPendente] = useState<string | null>(null);
  const caixaDeComentario = useRef<HTMLTextAreaElement>(null);

  /** Setas pressionadas neste instante, para reconhecer a diagonal. */
  const teclas = useRef(new Set<string>());
  const caixa = useRef<HTMLDivElement>(null);
  const centro = useRef<HTMLDivElement>(null);
  const alvos = useRef(new Map<Direcao, HTMLElement>());
  const campo = useRef<HTMLInputElement>(null);

  /**
   * A bussola nao se reordena. Nunca.
   *
   * A ordem e a das categorias no cadastro (`position`), que e estavel entre
   * sessoes, entre meses e entre maquinas. A primeira versao ordenava pelo uso
   * no mes, e era pior de um jeito que so aparece com o tempo: a posicao mudava
   * sozinha conforme o mes andava, e a memoria muscular — a unica razao de isto
   * ser mais rapido que arrastar — nunca chegava a se formar.
   */
  const bussola = categorias;

  const paginas = Math.max(1, Math.ceil(bussola.length / POR_VOLTA));
  const daVolta = bussola.slice(pagina * POR_VOLTA, pagina * POR_VOLTA + POR_VOLTA);

  const porDirecao = new Map<Direcao, CategoriaParaClassificar>();
  daVolta.forEach((categoria, i) => porDirecao.set(PREENCHIMENTO[i], categoria));

  const fila = lancamentos.filter((l) => !despachados.has(l.id));
  // O indice da a volta: quem foi pulado reaparece no fim, em vez de sumir.
  const atual = fila.length ? fila[indice % fila.length] : undefined;
  const escolhida = direcao ? porDirecao.get(direcao) : undefined;

  const opcoes = escolhida ? filtrarSubcategorias(escolhida.centros, digitado) : [];

  // Foco na caixa: sem ele as setas rolariam a pagina de fundo em vez de mirar.
  useEffect(() => {
    caixa.current?.focus();
  }, []);

  useEffect(() => {
    if (subcategoria !== null) campo.current?.focus();
  }, [subcategoria !== null]);

  useEffect(() => {
    if (comentario !== null) caixaDeComentario.current?.focus();
  }, [comentario !== null]);

  // A selecao do trecho completado so pode ser feita depois que o valor novo
  // esta no campo — antes disso os indices apontam para o texto velho.
  useEffect(() => {
    const alvo = selecao.current;
    if (!alvo || !campo.current) return;
    selecao.current = null;
    campo.current.setSelectionRange(alvo[0], alvo[1]);
  });

  function limparMira() {
    setDirecao(null);
    setSubcategoria(null);
    setDigitado("");
    setComentario(null);
    setComentarioPendente(null);
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

  /**
   * @param aContraparteToda Shift junto do enter: a categoria passa a valer
   * para todo lancamento da mesma origem, passado e futuro. E o mesmo que o
   * Ctrl faz ao soltar um cartao na lista.
   */
  function classificar(aContraparteToda = false) {
    if (!atual || !escolhida || !direcao) return;

    levantarVoo(atual, direcao, escolhida.hue);
    onClassificar(atual, escolhida.id, {
      subcategoria: subcategoria ?? undefined,
      aContraparteToda,
      comentario: (comentario ?? comentarioPendente) ?? undefined,
    });
    setDespachados((atuais) => new Set(atuais).add(atual.id));

    if (aContraparteToda) {
      // Uma regra que muda o historico inteiro nao acontece em silencio, ainda
      // mais aqui, onde a proxima despesa ja tomou a tela.
      const alvo = atual.alvoDaRegra ?? "esta contraparte";
      setAviso(`${escolhida.name} vale agora para tudo de ${alvo}`);
      window.setTimeout(() => setAviso(null), 4000);
    }

    limparMira();
    // Sem mexer no indice: a despesa sai da fila e a seguinte assume o lugar.
    // Avancar tambem pularia uma.
  }

  useEffect(() => {
    function baixou(evento: KeyboardEvent) {
      // Com um campo de texto aberto o teclado e dele: as setas escolhem
      // sugestao e as letras sao letras. Quem trata isso e o proprio campo.
      if (subcategoria !== null || comentario !== null) return;

      if (evento.key === "Escape") {
        onFechar();
        return;
      }

      // Fila vazia: as setas e o enter passam a ser da fita de datas, que a
      // essa altura e a unica coisa a fazer aqui.
      if (!atual) return;

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
        // Shift so vale com contraparte identificada: sem ela nao ha o que
        // generalizar, e o enter comum e o que acontece.
        classificar(evento.shiftKey && Boolean(atual.contraparteKey));
        return;
      }

      // Espaco abre a subcategoria da categoria mirada. Sem mira nao ha lista
      // de onde escolher, entao nao ha o que abrir.
      if (evento.key === " ") {
        evento.preventDefault();
        if (escolhida) {
          setSugestao(0);
          setDigitado("");
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

      // `c` de comentario. Abre com o que ja estava escrito — o do banco, ou o
      // que se digitou e ainda nao foi salvo.
      if (evento.key === "c" || evento.key === "C") {
        evento.preventDefault();
        setComentario(comentarioPendente ?? atual.comentario ?? "");
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

  /**
   * O campo completa sozinho enquanto se digita.
   *
   * Digitou "vi", o campo fica "Viagem Bariloche" com "agem Bariloche"
   * selecionado: a proxima tecla substitui o completado, e o enter aceita o que
   * esta la. E o comportamento que o navegador ja faz em campo de endereco, e a
   * mao ja conhece.
   */
  function aoDigitar(evento: React.ChangeEvent<HTMLInputElement>) {
    const bruto = evento.target.value;
    const apagando = (evento.nativeEvent as InputEvent).inputType?.startsWith("delete");

    setDigitado(bruto);
    setSugestao(0);

    // Apagando nao se completa: o campo brigaria com quem esta tentando apagar,
    // devolvendo a cada backspace a letra que acabou de sair.
    const completo = apagando || !escolhida ? null : completarSubcategoria(escolhida.centros, bruto);

    if (!completo) {
      setSubcategoria(bruto);
      return;
    }

    setSubcategoria(completo);
    selecao.current = [Math.min(bruto.length, completo.length), completo.length];
  }

  /**
   * Teclas da caixa de comentario.
   *
   * Enter quebra linha, como em qualquer caixa de texto. Ctrl+enter grava
   * agora, sem esperar a classificacao — comentar e classificar sao coisas
   * independentes, e ha despesa que se quer comentar sem categorizar.
   */
  function naCaixaDeComentario(evento: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (evento.key === "Escape") {
      evento.preventDefault();
      // Guarda o texto em vez de descarta-lo: ele vai junto na classificacao.
      setComentarioPendente(comentario);
      setComentario(null);
      caixa.current?.focus();
      return;
    }

    if (evento.key === "Enter" && (evento.metaKey || evento.ctrlKey)) {
      evento.preventDefault();
      if (!atual) return;

      onComentar(atual, comentario ?? "");
      setComentarioPendente(comentario);
      setComentario(null);
      caixa.current?.focus();
      setAviso("Comentario salvo");
      window.setTimeout(() => setAviso(null), 2500);
    }
  }

  /** Teclas do campo de subcategoria, enquanto ele esta aberto. */
  function noCampo(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      evento.preventDefault();
      setSubcategoria(null);
      setDigitado("");
      caixa.current?.focus();
      return;
    }

    // As setas percorrem as alternativas, inclusive as que so contem o texto —
    // e o caminho para "Servico de vidro" quando se digitou "vid".
    if (evento.key === "ArrowDown" || evento.key === "ArrowUp") {
      evento.preventDefault();
      if (opcoes.length === 0) return;

      const passo = evento.key === "ArrowDown" ? 1 : -1;
      const proxima = (sugestao + passo + opcoes.length) % opcoes.length;
      setSugestao(proxima);
      setSubcategoria(opcoes[proxima]);
      selecao.current = [opcoes[proxima].length, opcoes[proxima].length];
      return;
    }

    if (evento.key === "Enter") {
      evento.preventDefault();
      // O que esta no campo vence: o completado ja esta la, e a seta tambem
      // escreve nele. Nao ha um segundo lugar de onde tirar a escolha.
      const escolha = (subcategoria ?? "").trim();
      const aTodos = evento.shiftKey && Boolean(atual?.contraparteKey);

      if (!atual || !escolhida || !direcao) return;
      levantarVoo(atual, direcao, escolhida.hue);
      onClassificar(atual, escolhida.id, {
        subcategoria: escolha || undefined,
        aContraparteToda: aTodos,
        comentario: comentarioPendente ?? undefined,
      });
      setDespachados((atuais) => new Set(atuais).add(atual.id));

      if (aTodos) {
        const alvo = atual.alvoDaRegra ?? "esta contraparte";
        setAviso(`${escolhida.name} vale agora para tudo de ${alvo}`);
        window.setTimeout(() => setAviso(null), 4000);
      }

      limparMira();
      caixa.current?.focus();
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
            <strong>{diaPorExtenso(dia)}</strong> — {restam}{" "}
            {restam === 1 ? "despesa" : "despesas"} sem categoria
          </span>
          <button type="button" className="jogo-sair" onClick={onFechar}>
            sair (esc)
          </button>
        </div>

        {!atual ? (
          <div className="jogo-fim">
            <strong>Dia limpo.</strong>
            <span className="account-meta">
              Nenhuma despesa deste dia esta sem categoria. Escolha outro para continuar — a
              bolinha laranja diz onde ainda ha trabalho.
            </span>

            {/* A fita fica aqui, e nao um botao "fechar": quem acabou um dia
                quer o proximo, nao a lista de tras. */}
            <SpinnerDeDatas
              dia={dia}
              queryExtra={queryExtra}
              situacoes={situacoes}
              navegacaoPorTeclado
            />

            <div className="jogo-fim-legenda">
              <span className="jogo-legenda">
                <span className="spinner-bolha pendente" aria-hidden /> a classificar
              </span>
              <span className="jogo-legenda">
                <span className="spinner-bolha pronto" aria-hidden /> tudo classificado
              </span>
              <span className="jogo-legenda">
                <span className="spinner-bolha sem-dados" aria-hidden /> ainda nao recebido
              </span>
            </div>

            <span className="account-meta">setas escolhem o dia · enter vai · esc sai</span>

            <button type="button" className="jogo-sair" onClick={onFechar}>
              voltar para a lista
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

                {/* Comentario que ja existe, quando a caixa esta fechada: sem
                    isto, `c` pareceria abrir uma caixa vazia sobre um gasto que
                    ja tinha nota. */}
                {comentario === null && (comentarioPendente ?? atual.comentario) ? (
                  <span className="jogo-nota">{comentarioPendente ?? atual.comentario}</span>
                ) : null}

                {comentario !== null ? (
                  <div className="jogo-sub jogo-comentario">
                    <textarea
                      ref={caixaDeComentario}
                      rows={3}
                      value={comentario}
                      placeholder="o que foi este gasto"
                      aria-label="Comentario"
                      onChange={(evento) => setComentario(evento.target.value)}
                      onKeyDown={naCaixaDeComentario}
                    />
                    <span className="account-meta">
                      ctrl+enter grava agora · esc guarda e volta, e o texto vai junto na
                      classificacao
                    </span>
                  </div>
                ) : subcategoria !== null && escolhida ? (
                  <div className="jogo-sub">
                    <input
                      ref={campo}
                      type="text"
                      value={subcategoria}
                      placeholder={`subcategoria de ${escolhida.name}`}
                      aria-label={`Subcategoria de ${escolhida.name}`}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={aoDigitar}
                      onKeyDown={noCampo}
                    />

                    {/* As alternativas em texto, nao em botao: aqui ninguem
                        larga o teclado para clicar, e alvo de clique so
                        convidaria a isso. */}
                    {opcoes.length > 1 ? (
                      <span className="jogo-alternativas">
                        {opcoes.length} nomes · setas percorrem
                      </span>
                    ) : null}

                    <span className="account-meta">
                      {subcategoria.trim() && !opcoes.includes(subcategoria)
                        ? `enter cria "${subcategoria.trim()}"`
                        : "enter classifica · esc volta"}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="jogo-confirmar"
                    disabled={!escolhida}
                    onClick={() => classificar()}
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

            {aviso ? (
              <p className="jogo-aviso" role="status">
                {aviso}
              </p>
            ) : null}

            <div className="jogo-rodape">
              <span className="account-meta">
                setas miram · duas juntas fazem a diagonal · enter classifica · shift+enter vale
                para toda a contraparte · espaco abre a subcategoria · c comenta · i mostra o que se sabe ·
                backspace pula
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
