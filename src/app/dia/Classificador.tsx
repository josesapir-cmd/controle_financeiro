"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
import { rotuloContemNome } from "@/lib/finance/rotulo";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";
import { ModoJogo } from "./ModoJogo";
import { classificarLancamento, limparLancamento } from "./actions";

/**
 * Classificar gastos arrastando o cartao para o bloco da categoria.
 *
 * O cartao NAO migra para dentro do bloco: ele fica na lista e muda de cor. A
 * lista do dia continua sendo a lista do dia — se os cartoes sumissem ao serem
 * classificados, o dia se desmontaria enquanto se olha para ele.
 *
 * Sao dois arrastes diferentes, de proposito:
 *
 * - **No computador**, arrastar e soltar do HTML5, com os blocos em duas
 *   colunas grudadas a direita — as dez categorias cabem de uma vez na altura
 *   da tela, entao so a lista de despesas rola e o alvo nunca sai de vista.
 * - **No celular**, eventos de ponteiro e um dock no rodape. O arraste do HTML5
 *   no toque exige segurar o dedo parado antes de comecar; aqui o cartao sai
 *   com 4px de movimento, sem espera.
 *
 * E o seletor de categoria em cada cartao continua fazendo a mesma coisa sem
 * arraste nenhum, porque nada disso funciona no teclado.
 */

/** Ampliacao do dock, no formato do dock do macOS. */
const ALCANCE = 58;
const ALTURA_DO_PULO = 30;
/** Acima disto o dedo esta longe demais do dock para mirar numa celula. */
const MIRA = 90;
/** Movimento minimo para virar arraste em vez de toque. */
const LIMIAR = 4;
/** Janela entre os dois toques do duplo, em ms. */
const DUPLO = 320;

interface Arraste {
  id: string;
  /** Posicao do dedo, relativa ao container. */
  x: number;
  y: number;
  /** Posicao absoluta na tela, para medir a distancia ate as celulas. */
  telaX: number;
  telaY: number;
  alvo: string | null;
}

const MES = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

interface Props {
  lancamentos: LancamentoParaClassificar[];
  categorias: CategoriaParaClassificar[];
}

export function Classificador({ lancamentos, categorias }: Props) {
  /** Bloco sob o cursor durante o arraste. */
  const [sobre, setSobre] = useState<string | null>(null);
  const [arraste, setArraste] = useState<Arraste | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const celulas = useRef(new Map<string, HTMLElement>());
  /** Editor aberto, por lancamento. */
  const [aberto, setAberto] = useState<string | null>(null);
  /** Bloco que acabou de receber um cartao, para o pulo do icone. */
  const [pulou, setPulou] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();
  const origem = useRef<{ x: number; y: number; id: string } | null>(null);
  /** Cartao em modo arrastar. So ele arrasta, e so ele trava a rolagem. */
  const [armado, setArmado] = useState<string | null>(null);
  /** Ultimo toque, para reconhecer o duplo. */
  const toque = useRef<{ id: string; tempo: number } | null>(null);
  /** Recado de uma classificacao que passou de um lancamento so. */
  const [aviso, setAviso] = useState<string | null>(null);
  const [jogando, setJogando] = useState(false);

  /** O que o modo jogo despacha: so o que ainda pede categoria. */
  const semCategoria = lancamentos.filter((l) => l.classificavel && !l.categoriaId);

  // Sair do modo arrastar sem precisar acertar o cartao de novo: Esc, ou um
  // toque em qualquer outro lugar. Um cartao que fica armado sozinho e um
  // pedaco da tela que nao rola mais, e ninguem adivinha por que.
  useEffect(() => {
    if (!armado) return;

    const fora = (evento: PointerEvent) => {
      const alvo = evento.target as Element | null;
      if (!alvo?.closest?.(`[data-lanc="${armado}"]`)) setArmado(null);
    };
    const tecla = (evento: KeyboardEvent) => {
      if (evento.key === "Escape") setArmado(null);
    };

    document.addEventListener("pointerdown", fora);
    document.addEventListener("keydown", tecla);
    return () => {
      document.removeEventListener("pointerdown", fora);
      document.removeEventListener("keydown", tecla);
    };
  }, [armado]);

  const porId = new Map(categorias.map((c) => [c.id, c]));
  const emArraste = arraste ? lancamentos.find((l) => l.id === arraste.id) : undefined;

  /**
   * Escala de cada celula pela distancia horizontal do dedo.
   *
   * A ampliacao e por `transform`, entao aumentar uma celula nao empurra as
   * vizinhas — o alvo nao foge de baixo do dedo enquanto ele se aproxima.
   */
  function ampliacao(id: string): { transform: string } | undefined {
    if (!arraste) return undefined;

    const celula = celulas.current.get(id);
    if (!celula) return undefined;

    const caixa = celula.getBoundingClientRect();
    const centro = caixa.left + caixa.width / 2;
    const escala = 1 + 0.8 * Math.exp(-(((arraste.telaX - centro) / ALCANCE) ** 2));

    return {
      transform: `translateY(${-(escala - 1) * ALTURA_DO_PULO}px) scale(${escala})`,
    };
  }

  /** Celula mais proxima do dedo, se ele estiver perto o bastante do dock. */
  function mirar(telaX: number, telaY: number): string | null {
    let melhor: { id: string; distancia: number } | null = null;

    for (const [id, celula] of celulas.current) {
      const caixa = celula.getBoundingClientRect();
      if (telaY < caixa.top - MIRA) continue;

      const distancia = Math.abs(telaX - (caixa.left + caixa.width / 2));
      if (!melhor || distancia < melhor.distancia) melhor = { id, distancia };
    }

    return melhor?.id ?? null;
  }

  /**
   * @param aContraparteToda Grava tambem o cadastro da contraparte, entao a
   * categoria passa a valer para todo lancamento dela — passado e futuro. E o
   * que o Ctrl faz ao soltar. Sem contraparte identificada nao ha o que
   * generalizar: cai no comportamento normal, de um lancamento so.
   */
  function classificar(
    lancamento: LancamentoParaClassificar,
    categoriaId: string,
    aContraparteToda = false,
    subcategoria?: string,
  ) {
    const dados = new FormData();
    dados.set("transactionId", lancamento.id);
    dados.set("categoryId", categoriaId);
    if (lancamento.comentario) dados.set("note", lancamento.comentario);
    // O servidor acha ou cria: o mesmo campo serve para escolher uma
    // subcategoria que ja existe e para inventar uma na hora.
    if (subcategoria?.trim()) dados.set("novaSubcategoria", subcategoria.trim());

    const amplo = aContraparteToda && Boolean(lancamento.contraparteKey);
    if (amplo) {
      dados.set("aplicarATodos", "sim");
      dados.set("counterpartyKey", lancamento.contraparteKey ?? "");
    }

    setPulou(categoriaId);
    setTimeout(() => setPulou(null), 620);

    // Classificar NAO abre o detalhamento. Abrir a cada arraste enchia a tela
    // de paineis que ninguem pediu, bem no meio de uma sequencia de arrastes.
    // Quem quer subcategoria ou comentario clica na etiqueta.
    if (amplo) {
      // Uma regra que muda o historico inteiro nao pode acontecer em silencio.
      const nome = lancamento.alvoDaRegra ?? "esta contraparte";
      setAviso(`${porId.get(categoriaId)?.name ?? "Categoria"} vale agora para tudo de ${nome}`);
      setTimeout(() => setAviso(null), 4000);
    }

    iniciar(() => {
      void classificarLancamento(dados);
    });
  }

  return (
    <div className="classificador" ref={container}>
      {jogando ? (
        <ModoJogo
          lancamentos={semCategoria}
          categorias={categorias}
          onClassificar={(lancamento, categoriaId, subcategoria) =>
            classificar(lancamento, categoriaId, false, subcategoria)
          }
          onFechar={() => setJogando(false)}
        />
      ) : null}

      <div className="classificador-lista">
        {semCategoria.length > 0 && categorias.length > 0 ? (
          <button type="button" className="jogo-abrir" onClick={() => setJogando(true)}>
            Classificar no teclado
            <span className="jogo-abrir-conta">{semCategoria.length}</span>
          </button>
        ) : null}

        {lancamentos.length === 0 ? (
          <p className="empty">Nenhum lancamento neste dia.</p>
        ) : null}

        {lancamentos.map((lancamento) => {
          const categoria = lancamento.categoriaId ? porId.get(lancamento.categoriaId) : undefined;
          const centro = categoria?.centros.find((c) => c.id === lancamento.centroId);

          return (
            <article
              key={lancamento.id}
              className={[
                "lanc",
                !lancamento.classificavel
                  ? "lanc-fora"
                  : categoria
                    ? "lanc-classificado"
                    : "lanc-pendente",
                armado === lancamento.id ? "lanc-armado" : "",
                arraste?.id === lancamento.id ? "lanc-saindo" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={categoria ? ({ "--cat-h": categoria.hue } as React.CSSProperties) : undefined}
              data-lanc={lancamento.id}
              // No computador o arraste do HTML5 vale direto; no toque ele nao
              // acontece, e quem arrasta e o caminho de ponteiro abaixo, que
              // exige o cartao armado.
              draggable={lancamento.classificavel}
              onDragStart={(evento) => {
                evento.dataTransfer.setData("text/plain", lancamento.id);
                evento.dataTransfer.effectAllowed = "move";
              }}
              onPointerDown={(evento) => {
                if (!lancamento.classificavel) return;
                // No computador nao ha modo a armar: arrastar ja arrasta, e o
                // duplo clique so serviria para atrapalhar quem seleciona texto.
                if (evento.pointerType === "mouse") return;

                // Toque em controle e do controle: abrir o editor ou escolher no
                // seletor nao pode armar o arraste por baixo.
                const alvo = evento.target as Element | null;
                if (alvo?.closest?.("button, select, input, textarea, label, a")) return;

                const agora = Date.now();
                const anterior = toque.current;
                const duplo =
                  anterior && anterior.id === lancamento.id && agora - anterior.tempo < DUPLO;

                if (duplo) {
                  toque.current = null;
                  evento.preventDefault();
                  setArmado((atual) => (atual === lancamento.id ? null : lancamento.id));
                  return;
                }

                toque.current = { id: lancamento.id, tempo: agora };

                // Sem armar, o cartao e so texto: a lista rola normalmente por
                // cima dele. Era isto que estava travado antes.
                if (armado !== lancamento.id) return;
                // A captura NAO acontece aqui. Com o ponteiro capturado, o
                // `click` vai para o cartao e nunca chega ao botao da etiqueta,
                // que e justamente o que abre o editor. So capturamos quando
                // vira arraste de verdade.
                origem.current = { x: evento.clientX, y: evento.clientY, id: lancamento.id };
              }}
              onPointerMove={(evento) => {
                const inicio = origem.current;
                if (!inicio || inicio.id !== lancamento.id) return;

                const distancia = Math.hypot(
                  evento.clientX - inicio.x,
                  evento.clientY - inicio.y,
                );
                if (!arraste && distancia < LIMIAR) return;
                if (!arraste) evento.currentTarget.setPointerCapture(evento.pointerId);

                const caixa = container.current?.getBoundingClientRect();
                setArraste({
                  id: lancamento.id,
                  x: evento.clientX - (caixa?.left ?? 0),
                  y: evento.clientY - (caixa?.top ?? 0),
                  telaX: evento.clientX,
                  telaY: evento.clientY,
                  alvo: mirar(evento.clientX, evento.clientY),
                });
              }}
              onPointerUp={() => {
                origem.current = null;
                if (arraste?.alvo) {
                  classificar(lancamento, arraste.alvo);
                  setArmado(null);
                }
                setArraste(null);
              }}
              onPointerCancel={() => {
                origem.current = null;
                setArraste(null);
              }}
            >
              <div className="lanc-topo">
                <span className="lanc-hora">{lancamento.hora}</span>
                <span className="lanc-desc">{lancamento.descricao}</span>
                <span
                  className={`lanc-valor${lancamento.valor >= 0 ? " positive" : ""}`}
                >
                  {formatBRL(lancamento.valor)}
                </span>
              </div>

              {/* O que foi comprado, quando um print de tela de pedido disse.
                  Linha propria e nao mais um item na meta: e a informacao que
                  a fatura nao tem, e ela some se virar mais um "·". */}
              {lancamento.produtos.length > 0 ? (
                <div className="lanc-produtos">{lancamento.produtos.join(" · ")}</div>
              ) : null}

              <div className="lanc-meta">
                {[
                  lancamento.classificavel && !categoria ? "Sem categoria" : null,
                  // "PIX para Fulano · Fulano" nao ajuda ninguem: quando o
                  // titulo ja diz para quem foi, a linha de baixo cala.
                  rotuloContemNome(lancamento.descricao, lancamento.contraparte)
                    ? null
                    : lancamento.contraparte,
                  lancamento.conta,
                  lancamento.frequencia > 1 ? `${lancamento.frequencia} lancamentos` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>

              {lancamento.classificavel ? (
                <div className="lanc-rodape">
                  {categoria ? (
                    <>
                      <button
                        type="button"
                        className="lanc-etiqueta"
                        onClick={() => setAberto(aberto === lancamento.id ? null : lancamento.id)}
                        aria-expanded={aberto === lancamento.id}
                      >
                        {categoria.name}
                        {centro ? ` · ${centro.name}` : ""}
                        {lancamento.herdada ? " (da contraparte)" : ""}
                      </button>

                      {/* O mesmo que o Ctrl faz ao soltar, para quem nao tem
                          teclado ou nao conhece o atalho. Some quando a
                          categoria JA veio da regra: clicar seria um nada. */}
                      {lancamento.contraparteKey && !lancamento.herdada ? (
                        <button
                          type="button"
                          className="lanc-todos"
                          disabled={pendente}
                          title={`Todo lancamento de ${lancamento.alvoDaRegra ?? "mesma origem"} passa a ser ${categoria.name}`}
                          onClick={() => classificar(lancamento, categoria.id, true)}
                        >
                          aplicar a todos
                          {lancamento.frequencia > 1 ? ` (${lancamento.frequencia})` : ""}
                        </button>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span className="lanc-dica">
                        {armado === lancamento.id ? (
                          "arraste para um bloco"
                        ) : (
                          <>
                            {/* Duas frases porque o gesto e outro: no
                                computador basta arrastar; no toque, o cartao
                                precisa ser armado antes. Quem decide qual
                                aparece e o CSS, pelo tipo de ponteiro. */}
                            <span className="dica-mouse">arraste para um bloco</span>
                            <span className="dica-toque">toque duas vezes para arrastar</span>
                          </>
                        )}
                      </span>

                      {/* O mesmo destino, sem arrastar: no teclado esta e a
                          unica forma que funciona. So aparece enquanto o
                          lancamento nao tem categoria — depois disso quem
                          recategoriza e o arraste, e para o teclado sobra
                          "tirar a categoria" dentro do editor. */}
                      <label className="lanc-escolha">
                        <span className="account-meta">categoria</span>
                        <select
                          value=""
                          disabled={pendente}
                          onChange={(evento) => {
                            if (evento.target.value) classificar(lancamento, evento.target.value);
                          }}
                          aria-label={`Categoria de ${lancamento.descricao}`}
                        >
                          <option value="">escolher…</option>
                          {categorias.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  )}
                </div>
              ) : null}

              {aberto === lancamento.id && categoria ? (
                <Editor lancamento={lancamento} categoria={categoria} onFechar={() => setAberto(null)} />
              ) : null}
            </article>
          );
        })}
      </div>

      <div className={`blocos ${arraste ? "blocos-mirando" : ""}`} aria-label="Categorias">
        {categorias.map((categoria) => {
          const vazio = categoria.lancamentosNoDia === 0;

          return (
            <div
              key={categoria.id}
              ref={(elemento) => {
                if (elemento) celulas.current.set(categoria.id, elemento);
                else celulas.current.delete(categoria.id);
              }}
              className={[
                "bloco",
                vazio ? "bloco-vazio" : "",
                sobre === categoria.id || arraste?.alvo === categoria.id ? "bloco-sobre" : "",
                pulou === categoria.id ? "bloco-pulou" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={
                {
                  "--cat-h": categoria.hue,
                  ...ampliacao(categoria.id),
                } as React.CSSProperties
              }
              title={categoria.hint ?? undefined}
              onDragOver={(evento) => {
                evento.preventDefault();
                evento.dataTransfer.dropEffect = "move";
                if (sobre !== categoria.id) setSobre(categoria.id);
              }}
              onDragLeave={() => setSobre((atual) => (atual === categoria.id ? null : atual))}
              onDrop={(evento) => {
                evento.preventDefault();
                setSobre(null);
                const id = evento.dataTransfer.getData("text/plain");
                const lancamento = lancamentos.find((l) => l.id === id);
                // Ctrl (ou Cmd, no Mac) ao soltar: a categoria vale para a
                // contraparte inteira, nao so para este lancamento.
                if (lancamento) {
                  classificar(lancamento, categoria.id, evento.ctrlKey || evento.metaKey);
                }
                setArmado(null);
              }}
            >
              <span className="bloco-bolha" aria-hidden />

              <span className="bloco-topo">
                <IconeDeCategoria nome={categoria.name} tamanho={30} animar={!vazio} />
                <span className="bloco-nome">{categoria.name}</span>
                {categoria.lancamentosNoDia > 0 ? (
                  <span className="bloco-badge">{categoria.lancamentosNoDia}</span>
                ) : null}
              </span>

              {vazio ? <span className="bloco-solte">solte aqui</span> : null}

              <span className="bloco-rodape">
                {MES.format(categoria.noDia)} / {MES.format(categoria.noMes)}
              </span>
            </div>
          );
        })}

        {/* Legenda do atalho: uma regra que vale para toda a contraparte tem de
            ser descobrivel, e nao existe no toque — por isso o CSS a esconde
            onde nao ha teclado. */}
        <p className="blocos-dica dica-mouse">
          Segure <kbd>Ctrl</kbd> ao soltar para valer para toda a contraparte
        </p>
      </div>

      {/* Fantasma do cartao seguindo o dedo. Fica dentro do container, em
          posicao absoluta: `fixed` sairia do enquadramento em telas com barra
          de navegacao sobreposta. */}
      {arraste && emArraste ? (
        <div className="fantasma" style={{ left: arraste.x, top: arraste.y }} aria-hidden>
          <span className="lanc-desc">{emArraste.descricao}</span>
          <span className="lanc-valor">{formatBRL(emArraste.valor)}</span>
        </div>
      ) : null}

      {arraste?.alvo ? (
        <div className="mira">{porId.get(arraste.alvo)?.name}</div>
      ) : null}

      {aviso ? (
        <p className="classificador-aviso" role="status">
          {aviso}
        </p>
      ) : null}
    </div>
  );
}

/**
 * Editor no proprio cartao: subcategoria, comentario e a decisao de estender a
 * regra para toda a contraparte.
 */
function Editor({
  lancamento,
  categoria,
  onFechar,
}: {
  lancamento: LancamentoParaClassificar;
  categoria: CategoriaParaClassificar;
  onFechar: () => void;
}) {
  const comentario = lancamento.comentario ?? "";
  // Comentario salvo aparece como texto; a caixa so volta pelo lapis. Um campo
  // aberto o tempo todo faz o que ja foi escrito parecer rascunho.
  const [editandoNota, setEditandoNota] = useState(!comentario);
  useEffect(() => setEditandoNota(!comentario), [comentario]);

  return (
    <form action={classificarLancamento} className="lanc-editor">
      <input type="hidden" name="transactionId" value={lancamento.id} />
      <input type="hidden" name="categoryId" value={categoria.id} />
      <input type="hidden" name="counterpartyKey" value={lancamento.contraparteKey ?? ""} />

      <div>
        <div className="editor-titulo">Subcategoria de {categoria.name}</div>
        <div className="editor-chips">
          {categoria.centros.map((centro) => (
            <label
              key={centro.id}
              className={centro.id === lancamento.centroId ? "chip chip-ativo" : "chip"}
            >
              <input
                type="radio"
                name="costCenterId"
                value={centro.id}
                defaultChecked={centro.id === lancamento.centroId}
              />
              {centro.name}
            </label>
          ))}
        </div>
        <input
          type="text"
          name="novaSubcategoria"
          placeholder="+ nova subcategoria"
          aria-label="Nova subcategoria"
          className="editor-nova"
        />
      </div>

      <div>
        <div className="editor-titulo">
          Comentario
          {comentario && !editandoNota ? (
            <button
              type="button"
              className="editor-lapis"
              onClick={() => setEditandoNota(true)}
              aria-label="Editar comentario"
              title="Editar comentario"
            >
              <Lapis />
            </button>
          ) : null}
        </div>

        {comentario && !editandoNota ? (
          <>
            <p className="editor-nota">{comentario}</p>
            {/* O comentario ja salvo continua viajando no envio: sem isto,
                salvar uma subcategoria apagaria o texto que esta na tela. */}
            <input type="hidden" name="note" value={comentario} />
          </>
        ) : (
          <textarea
            name="note"
            rows={3}
            defaultValue={comentario}
            placeholder="o que foi este gasto"
            aria-label="Comentario"
          />
        )}

        {lancamento.contraparteKey && lancamento.frequencia > 1 ? (
          <label className="editor-aplicar">
            <input type="checkbox" name="aplicarATodos" value="sim" />
            <span>
              aplicar a todos de {lancamento.contraparte ?? "esta contraparte"} (
              {lancamento.frequencia})
            </span>
          </label>
        ) : null}

        <div className="editor-acoes">
          <button type="submit">Salvar</button>
          <button type="button" className="danger" onClick={onFechar}>
            Fechar
          </button>
        </div>
      </div>

      <div className="editor-tirar">
        <button type="submit" formAction={limparLancamento} className="editor-link">
          tirar a categoria
        </button>
      </div>
    </form>
  );
}

/** Lapis do botao de editar comentario. Inline, como o resto dos icones. */
function Lapis() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden focusable="false">
      <path
        d="M11.2 1.9a1.4 1.4 0 0 1 2 2l-.7.7-2-2 .7-.7ZM9.6 3.5l2 2L5 12.1l-2.6.6.6-2.6L9.6 3.5Z"
        fill="currentColor"
      />
    </svg>
  );
}
