"use client";

import { useState, useTransition } from "react";
import { IconeDeCategoria } from "@/components/IconeDeCategoria";
import { formatBRL } from "@/lib/finance/money";
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
 * O arraste e uma das formas, nao a unica: cada cartao tem um seletor de
 * categoria que faz a mesma coisa. Arrastar nao funciona no celular nem no
 * teclado, e a funcionalidade nao pode depender disso.
 */

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
  /** Editor aberto, por lancamento. */
  const [aberto, setAberto] = useState<string | null>(null);
  /** Bloco que acabou de receber um cartao, para o pulo do icone. */
  const [pulou, setPulou] = useState<string | null>(null);
  const [pendente, iniciar] = useTransition();

  const porId = new Map(categorias.map((c) => [c.id, c]));

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
    <div className="classificador">
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
              className={`lanc ${categoria ? "lanc-classificado" : "lanc-pendente"}`}
              style={categoria ? ({ "--cat-h": categoria.hue } as React.CSSProperties) : undefined}
              draggable={!categoria}
              onDragStart={(evento) => {
                evento.dataTransfer.setData("text/plain", lancamento.id);
                evento.dataTransfer.effectAllowed = "move";
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
                  lancamento.contraparte,
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

      <div className="blocos" aria-label="Categorias">
        {categorias.map((categoria) => {
          const vazio = categoria.lancamentosNoDia === 0;

          return (
            <div
              key={categoria.id}
              className={[
                "bloco",
                vazio ? "bloco-vazio" : "",
                sobre === categoria.id ? "bloco-sobre" : "",
                pulou === categoria.id ? "bloco-pulou" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ "--cat-h": categoria.hue } as React.CSSProperties}
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
