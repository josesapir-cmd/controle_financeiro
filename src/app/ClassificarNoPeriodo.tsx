"use client";

import { useState, useTransition } from "react";
import { ModoJogo } from "@/app/dia/ModoJogo";
import { classificarLancamento, comentarLancamento } from "@/app/dia/actions";
import { formatBRL } from "@/lib/finance/money";
import type {
  CategoriaParaClassificar,
  LancamentoParaClassificar,
} from "@/lib/finance/service";

/**
 * Abre o modo jogo para o periodo inteiro, do maior gasto para o menor.
 *
 * O jogo da aba Dia percorre um dia na ordem do relogio. Aqui a ordem e a do
 * valor: num mes com centenas de lancamentos, classificar na ordem em que
 * aconteceram gasta o mesmo esforco em cada um, e a maior parte do dinheiro
 * esta em poucos deles.
 */
export function ClassificarNoPeriodo({
  lancamentos,
  categorias,
  total,
  totalDoPeriodo,
  contagem,
}: {
  lancamentos: LancamentoParaClassificar[];
  categorias: CategoriaParaClassificar[];
  /** Soma das despesas sem categoria. */
  total: number;
  /** Soma de todas as despesas do periodo. */
  totalDoPeriodo: number;
  contagem: number;
}) {
  const [jogando, setJogando] = useState(false);
  const [despachados, setDespachados] = useState<ReadonlySet<string>>(new Set());
  const [, iniciar] = useTransition();

  const fila = lancamentos.filter((l) => !despachados.has(l.id));
  const fatia = totalDoPeriodo > 0 ? (total / totalDoPeriodo) * 100 : 0;

  return (
    <section className="card sem-categoria">
      <div>
        <div className="tile-label">Ainda sem categoria</div>
        <div className="tile-value negative">{formatBRL(total)}</div>
        <div className="tile-note">
          {contagem} {contagem === 1 ? "despesa" : "despesas"} ·{" "}
          {fatia.toFixed(1)}% do gasto do periodo
        </div>
      </div>

      {contagem > 0 && categorias.length > 0 ? (
        <button type="button" className="jogo-abrir" onClick={() => setJogando(true)}>
          Classificar no teclado
          <span className="jogo-abrir-conta">{fila.length}</span>
        </button>
      ) : null}

      {jogando ? (
        <ModoJogo
          lancamentos={fila}
          categorias={categorias}
          porValor
          totalDoPeriodo={totalDoPeriodo}
          onClassificar={(lancamento, categoriaId, opcoes) => {
            const dados = new FormData();
            dados.set("transactionId", lancamento.id);
            dados.set("categoryId", categoriaId);

            const nota = opcoes?.comentario ?? lancamento.comentario;
            if (nota) dados.set("note", nota);
            if (opcoes?.subcategoria?.trim()) {
              dados.set("novaSubcategoria", opcoes.subcategoria.trim());
            }
            if (opcoes?.aContraparteToda && lancamento.contraparteKey) {
              dados.set("aplicarATodos", "sim");
              dados.set("counterpartyKey", lancamento.contraparteKey);
            }

            setDespachados((atuais) => new Set(atuais).add(lancamento.id));
            iniciar(() => {
              void classificarLancamento(dados);
            });
          }}
          onComentar={(lancamento, texto) => {
            const dados = new FormData();
            dados.set("transactionId", lancamento.id);
            dados.set("note", texto);
            iniciar(() => {
              void comentarLancamento(dados);
            });
          }}
          onFechar={() => setJogando(false)}
        />
      ) : null}
    </section>
  );
}
