"use client";

import { useState } from "react";
import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL, formatPercent } from "@/lib/finance/money";
import type { DespesaPorCategoria } from "@/lib/finance/service";

/**
 * Distribuicao por categoria, aberta em tres niveis.
 *
 * Barra horizontal ordenada, e nao pizza nem treemap: a pergunta e comparar
 * magnitudes entre dez categorias, e comprimento numa base comum e a forma que
 * o olho compara melhor.
 *
 * Uma matiz so nas barras. A identidade ja esta escrita no nome de cada linha,
 * entao dez cores diferentes nao acrescentariam informacao — acrescentariam o
 * arco-iris que faz a leitura piorar. A bolinha na cor da categoria fica ao
 * lado do nome, onde ela e orientacao e nao codificacao.
 *
 * Abrir e estado de cliente e nao da URL: o dado ja veio inteiro na resposta,
 * entao cada clique seria uma ida ao servidor para nada.
 */

function Ponto({ hue }: { hue: number }) {
  return <span className="gr-ponto" style={{ "--cat-h": hue } as React.CSSProperties} aria-hidden />;
}

/** Triangulo que gira: o mesmo desenho nos dois niveis, para abrir ter uma cara so. */
function Seta({ aberto }: { aberto: boolean }) {
  return <span className={aberto ? "gr-seta aberta" : "gr-seta"} aria-hidden />;
}

export function DespesasPorCategoria({
  categorias,
  semCategoria,
  total,
}: {
  categorias: DespesaPorCategoria[];
  /** O que sobrou sem categoria, para a linha residual. */
  semCategoria: { total: number; contagem: number };
  /** Total do periodo, para a coluna de participacao e para o rodape. */
  total: number;
}) {
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(new Set());

  function alternar(chave: string) {
    setAbertas((atuais) => {
      const proximo = new Set(atuais);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  // Um periodo inteiro sem classificar tem zero categorias e nao e tela vazia:
  // e justamente o caso em que a linha do residual carrega o gasto todo.
  if (categorias.length === 0 && semCategoria.total === 0) return null;

  const temResidual = semCategoria.total > 0;
  // A escala da barra inclui o residual: duas magnitudes na mesma coluna
  // precisam da mesma base, senao a comparacao que a coluna existe para fazer
  // mente.
  const maior = Math.max(semCategoria.total, ...categorias.map((c) => c.total));
  const fatiaSemCategoria = total > 0 ? semCategoria.total / total : 0;

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Por categoria · {categorias.length}{" "}
        {categorias.length === 1 ? "categoria" : "categorias"} com gasto
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela gr-arvore">
          <thead>
            <tr>
              <th scope="col">Categoria</th>
              <th scope="col" className="gr-num">
                Valor
              </th>
              <th scope="col" className="gr-num">
                <span className="gr-so-largo">Participacao</span>
                <span className="gr-so-estreito">%</span>
              </th>
              <th scope="col" className="gr-so-largo">
                Distribuicao
              </th>
            </tr>
          </thead>

          {categorias.map((categoria) => {
            const chave = categoria.id ?? categoria.nome;
            const aberta = abertas.has(chave);
            const fatia = total > 0 ? categoria.total / total : 0;

            return (
              // Um tbody por categoria: o grupo aberto fica ligado ao seu
              // titulo tambem para quem le a tabela por leitor de tela.
              <tbody key={chave} className={aberta ? "gr-grupo aberto" : "gr-grupo"}>
                <tr>
                  <th scope="row">
                    <button
                      type="button"
                      className="gr-abrir"
                      onClick={() => alternar(chave)}
                      aria-expanded={aberta}
                    >
                      <Seta aberto={aberta} />
                      <Ponto hue={categoria.hue} />
                      {categoria.nome}
                      <span className="gr-badge">{categoria.contagem}</span>
                    </button>
                  </th>
                  <td className="gr-num">{formatBRL(categoria.total)}</td>
                  <td className="gr-num">{formatPercent(fatia * 100)}%</td>
                  <td className="gr-so-largo">
                    <span className="gr-barra" aria-hidden>
                      <span style={{ width: `${Math.max(1, (categoria.total / maior) * 100)}%` }} />
                    </span>
                  </td>
                </tr>

                {aberta
                  ? categoria.centros.map((centro) => {
                      const chaveDoCentro = `${chave}/${centro.id ?? "sem"}`;
                      const abertoOCentro = abertas.has(chaveDoCentro);

                      return [
                        <tr key={chaveDoCentro} className="gr-nivel-2">
                          <th scope="row">
                            <button
                              type="button"
                              className="gr-abrir"
                              onClick={() => alternar(chaveDoCentro)}
                              aria-expanded={abertoOCentro}
                            >
                              <Seta aberto={abertoOCentro} />
                              <span className={centro.id ? "" : "account-meta"}>{centro.nome}</span>
                              <span className="gr-badge">{centro.lancamentos.length}</span>
                            </button>
                          </th>
                          <td className="gr-num">{formatBRL(centro.total)}</td>
                          <td className="gr-num">
                            {categoria.total > 0
                              ? `${formatPercent((centro.total / categoria.total) * 100)}%`
                              : "—"}
                          </td>
                          <td className="gr-so-largo" />
                        </tr>,

                        ...(abertoOCentro
                          ? centro.lancamentos.map((lancamento) => (
                              <tr key={lancamento.id} className="gr-nivel-3">
                                <th scope="row">
                                  <span className="gr-folha">
                                    {lancamento.descricao}
                                    <span className="account-meta">
                                      {dataCompleta(lancamento.dia)}
                                      {lancamento.conta ? ` · ${lancamento.conta}` : ""}
                                    </span>
                                  </span>
                                </th>
                                <td className="gr-num">{formatBRL(lancamento.valor)}</td>
                                <td className="gr-num" />
                                <td className="gr-so-largo" />
                              </tr>
                            ))
                          : []),
                      ];
                    })
                  : null}
              </tbody>
            );
          })}

          {/* O residual por ultimo, e nao ordenado entre as categorias: ele nao
              e uma categoria que por acaso se chama assim — e o que sobrou de
              fora da classificacao, e o lugar dele e no fim, encostado no
              total. Sem ele as participacoes somavam menos de 100% e a coluna
              ficava sem explicacao. */}
          {temResidual ? (
            <tbody className="gr-grupo">
              <tr>
                <th scope="row">
                  {/* Nao abre: os lancamentos sem categoria ja estao no cartao
                      de classificar, acima, que e onde da para fazer algo com
                      eles. Repetir a arvore aqui seria a mesma lista duas
                      vezes na mesma tela. */}
                  <span className="gr-sem-seta" aria-hidden />
                  <span className="gr-residual">Nao classificado</span>
                  <span className="gr-badge">{semCategoria.contagem}</span>
                </th>
                <td className="gr-num">{formatBRL(semCategoria.total)}</td>
                <td className="gr-num">{formatPercent(fatiaSemCategoria * 100)}%</td>
                <td className="gr-so-largo">
                  <span className="gr-barra" aria-hidden>
                    <span style={{ width: `${Math.max(1, (semCategoria.total / maior) * 100)}%` }} />
                  </span>
                </td>
              </tr>
            </tbody>
          ) : null}

          {/* O total vem do painel, e nao de somar as linhas de novo: e o mesmo
              numero que a tela mostra nos cartoes e na tabela por conta, e
              recalcula-lo aqui abriria a porta para dois totais diferentes na
              mesma pagina. */}
          <tfoot>
            <tr className="gr-total">
              <th scope="row">Total</th>
              <td className="gr-num">{formatBRL(total)}</td>
              <td className="gr-num">{total > 0 ? `${formatPercent(100)}%` : "—"}</td>
              <td className="gr-so-largo" />
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}
