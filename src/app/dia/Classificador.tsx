"use client";

import { useRef, useState, useTransition } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
import { rotuloContemNome } from "@/lib/finance/rotulo";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";
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

  function classificar(lancamento: LancamentoParaClassificar, categoriaId: string) {
    const dados = new FormData();
    dados.set("transactionId", lancamento.id);
    dados.set("categoryId", categoriaId);
    if (lancamento.comentario) dados.set("note", lancamento.comentario);

    setPulou(categoriaId);
    setTimeout(() => setPulou(null), 620);
    setAberto(lancamento.id);

    iniciar(() => {
      void classificarLancamento(dados);
    });
  }

  return (
    <div className="classificador" ref={container}>
      <div className="classificador-lista">
        {lancamentos.length === 0 ? (
          <p className="empty">Nenhuma despesa sua neste dia.</p>
        ) : null}

        {lancamentos.map((lancamento) => {
          const categoria = lancamento.categoriaId ? porId.get(lancamento.categoriaId) : undefined;
          const centro = categoria?.centros.find((c) => c.id === lancamento.centroId);

          return (
            <article
              key={lancamento.id}
              className={[
                "lanc",
                categoria ? "lanc-classificado" : "lanc-pendente",
                arraste?.id === lancamento.id ? "lanc-saindo" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={categoria ? ({ "--cat-h": categoria.hue } as React.CSSProperties) : undefined}
              draggable={!categoria}
              onDragStart={(evento) => {
                evento.dataTransfer.setData("text/plain", lancamento.id);
                evento.dataTransfer.effectAllowed = "move";
              }}
              onPointerDown={(evento) => {
                // So toque: no computador quem manda e o arraste do HTML5, e os
                // dois juntos brigariam pelo mesmo gesto.
                if (categoria || evento.pointerType === "mouse") return;
                evento.currentTarget.setPointerCapture(evento.pointerId);
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
                if (arraste?.alvo) classificar(lancamento, arraste.alvo);
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
                <span className="lanc-valor">{formatBRL(lancamento.valor)}</span>
              </div>

              <div className="lanc-meta">
                {[
                  categoria ? null : "Sem categoria",
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

              <div className="lanc-rodape">
                {categoria ? (
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
                ) : (
                  <span className="lanc-dica">arraste para um bloco</span>
                )}

                {/* O mesmo destino, sem arrastar: no celular e no teclado esta e
                    a unica forma que funciona. */}
                <label className="lanc-escolha">
                  <span className="account-meta">categoria</span>
                  <select
                    value={lancamento.categoriaId ?? ""}
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
              </div>

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
                if (lancamento) classificar(lancamento, categoria.id);
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
        <div className="editor-titulo">Comentario</div>
        <textarea
          name="note"
          rows={3}
          defaultValue={lancamento.comentario ?? ""}
          placeholder="o que foi este gasto"
          aria-label="Comentario"
        />

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
