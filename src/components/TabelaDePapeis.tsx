"use client";

import { useState } from "react";
import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { PapelAgrupado } from "@/lib/finance/carteira";

/**
 * Os papeis da carteira, com as custodias por dentro.
 *
 * A linha de cima e o instrumento — "quanto tenho em Renda+ 2065" — porque essa
 * e a pergunta que se faz olhando a carteira. Onde esta custodiado so importa na
 * hora de resgatar, e por isso fica atras de um clique em vez de partir o total
 * em duas linhas que o olho precisa somar.
 *
 * So abre o que tem o que mostrar: com uma custodia unica o nome dela ja esta
 * escrito na linha, e um triangulo ali prometeria detalhe que nao existe.
 *
 * Abrir e estado de cliente e nao da URL: o dado ja veio inteiro na resposta.
 */

/** Triangulo que gira, o mesmo do painel de despesas. */
function Seta({ aberto }: { aberto: boolean }) {
  return <span className={aberto ? "gr-seta aberta" : "gr-seta"} aria-hidden />;
}

/**
 * Marca do ativo digitado a mao.
 *
 * Um losango vazado, nao um emoji: a tabela inteira e texto e numero, e um
 * emoji colorido no meio pesaria mais que o aviso que ele da. O que a marca
 * precisa dizer e "este numero nao se atualiza sozinho".
 *
 * O aviso vai tambem em texto, e nao so no `title`: quem le a tela por leitor
 * de tela nao passa o mouse em cima de nada.
 */
function MarcaManual({ avaliadoEm }: { avaliadoEm?: string | null }) {
  const legenda = avaliadoEm
    ? `Ativo digitado a mao — valor apurado em ${dataCompleta(avaliadoEm)}`
    : "Ativo digitado a mao, fora do Open Finance";

  return (
    <span className="gr-manual" title={legenda}>
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M12 3 21 12 12 21 3 12Z"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
      </svg>
      <span className="sr-only">{legenda}</span>
    </span>
  );
}

/**
 * A taxa da linha.
 *
 * Duas taxas disputam essa coluna e sao respostas a perguntas diferentes: a que
 * a corretora manda e a CONTRATADA na compra — o que se recebe levando ao
 * vencimento — e a digitada e a MARCADA hoje, que e o que se recebe vendendo
 * agora. Quando ha a marcada, e ela que aparece: e a que explica o saldo do
 * lado, que tambem e de hoje.
 *
 * A data vem junto, apagada. Taxa marcada envelhece em dias, e uma de tres
 * meses atras ao lado de um saldo de hoje e pior que traco nenhum.
 */
function Taxa({
  valor,
  marcada,
  marcadaEm,
}: {
  valor: number | null;
  marcada?: string | null;
  marcadaEm?: string | null;
}) {
  if (marcada) {
    return (
      <span
        className="gr-marcada"
        title={
          marcadaEm
            ? `Taxa marcada a mao, lida em ${dataCompleta(marcadaEm)}`
            : "Taxa marcada a mao"
        }
      >
        {marcada}
        {marcadaEm ? (
          <span className="gr-marcada-em">{dataCompleta(marcadaEm)}</span>
        ) : null}
      </span>
    );
  }

  // Renda fixa tem taxa contratada; fundo nao. O traco diz "nao se aplica",
  // e nao "zero".
  return <>{valor !== null ? `${valor.toFixed(2)}%` : "—"}</>;
}

function Lucro({ valor }: { valor: number | null }) {
  if (valor === null) return <>—</>;
  return (
    <span className={valor < 0 ? "negative" : "positive"}>
      {formatBRL(valor)}
    </span>
  );
}

export function TabelaDePapeis({ papeis }: { papeis: PapelAgrupado[] }) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());

  function alternar(chave: string) {
    setAbertos((atuais) => {
      const proximo = new Set(atuais);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Papeis · uma linha por instrumento
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela gr-arvore">
          <thead>
            <tr>
              <th scope="col">Papel</th>
              <th scope="col" className="gr-so-largo">
                Vencimento
              </th>
              <th scope="col" className="gr-num gr-so-largo">
                Taxa
              </th>
              <th scope="col" className="gr-num gr-so-largo">
                Lucro
              </th>
              <th scope="col" className="gr-num">
                Valor
              </th>
            </tr>
          </thead>

          {papeis.map((papel) => {
            const varias = papel.custodias.length > 1;
            const aberto = abertos.has(papel.id);

            const nome = (
              <>
                {papel.manual ? (
                  <MarcaManual avaliadoEm={papel.avaliadoEm} />
                ) : null}
                {papel.nome}
                <span className="account-meta"> · {papel.instituicao}</span>
                {/* So aparece quando ha o que somar: um "1" em toda linha seria
                    ruido, e o silencio ja diz posicao unica. */}
                {papel.posicoes > 1 ? (
                  <span
                    className="gr-badge"
                    title={`${papel.posicoes} posicoes somadas`}
                  >
                    {papel.posicoes}
                  </span>
                ) : null}
              </>
            );

            return (
              // Um tbody por papel: a custodia aberta fica ligada ao instrumento
              // tambem para quem le a tabela por leitor de tela.
              <tbody
                key={papel.id}
                className={aberto ? "gr-grupo aberto" : "gr-grupo"}
              >
                <tr>
                  <th scope="row">
                    {varias ? (
                      <button
                        type="button"
                        className="gr-abrir"
                        onClick={() => alternar(papel.id)}
                        aria-expanded={aberto}
                      >
                        <Seta aberto={aberto} />
                        {/* Um item de flex so para o rotulo inteiro: solto, cada
                            pedaco viraria um item, o espaco antes do "·" seria
                            descartado como espaco de borda e o badge deixaria de
                            assentar na linha de base do nome. */}
                        <span className="gr-rotulo">{nome}</span>
                      </button>
                    ) : (
                      nome
                    )}
                  </th>
                  <td className="gr-so-largo">
                    <span className="gr-data">
                      {papel.vence
                        ? dataCompleta(papel.vence)
                        : papel.manual && papel.avaliadoEm
                          ? `avaliado em ${dataCompleta(papel.avaliadoEm)}`
                          : "—"}
                    </span>
                  </td>
                  <td className="gr-num gr-so-largo">
                    <Taxa
                      valor={papel.taxa}
                      marcada={papel.taxaMarcada}
                      marcadaEm={papel.taxaMarcadaEm}
                    />
                  </td>
                  <td className="gr-num gr-so-largo">
                    <Lucro valor={papel.lucro} />
                  </td>
                  <td className="gr-num">{formatBRL(papel.saldo)}</td>
                </tr>

                {varias && aberto
                  ? papel.custodias.map((custodia) => (
                      <tr key={custodia.instituicao} className="gr-nivel-2">
                        <th scope="row">
                          {custodia.instituicao}
                          {custodia.posicoes > 1 ? (
                            <span className="gr-badge">
                              {custodia.posicoes}
                            </span>
                          ) : null}
                        </th>
                        <td className="gr-so-largo" />
                        <td className="gr-num gr-so-largo">
                          {/* Com o instrumento marcado a mao, a taxa e dele e
                              nao da custodia. Repeti-la em cada linha seria
                              ruido, e um traco se leria como "esta nao tem". */}
                          {papel.taxaMarcada &&
                          custodia.taxa === null ? null : (
                            <Taxa valor={custodia.taxa} />
                          )}
                        </td>
                        <td className="gr-num gr-so-largo">
                          <Lucro valor={custodia.lucro} />
                        </td>
                        <td className="gr-num">{formatBRL(custodia.saldo)}</td>
                      </tr>
                    ))
                  : null}
              </tbody>
            );
          })}
        </table>
      </div>
    </figure>
  );
}
