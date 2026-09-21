"use client";

import { useState } from "react";
import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL, formatPercent } from "@/lib/finance/money";
import { agruparPorClasse, type PapelNaCarteira } from "@/lib/finance/carteira";

/**
 * A carteira inteira numa tabela so, em tres niveis.
 *
 * Classe responde a pergunta de cima — "quanto tenho em CDB" — e e onde a
 * tabela comeca, fechada. Instrumento diz qual CDB, custodia diz onde ele esta.
 * Cada nivel abaixo do primeiro existe porque o de cima esconde o que
 * distingue; guardar atras de um clique nao e o mesmo que apagar.
 *
 * Esta tabela substituiu as duas que vinham antes dela — "por classe" e "por
 * instituicao". Eram resumos do que ela ja mostra, e tres tabelas do mesmo
 * dinheiro na mesma tela fazem o olho conferir em vez de ler.
 *
 * So abre o que tem o que mostrar: com um instrumento unico, ou uma custodia
 * unica, o nome ja esta escrito na linha e um triangulo prometeria detalhe que
 * nao existe.
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
  return <>{valor !== null ? `${formatPercent(valor, 2)}%` : "—"}</>;
}

/**
 * Quanto esta linha pesa no patrimonio.
 *
 * Sempre sobre o total da carteira, nos tres niveis — e nao sobre a linha de
 * cima. "Este CDB e 6% do que tenho" responde a pergunta que se faz olhando
 * patrimonio; "e 64% dos meus CDBs" responde outra, e misturar as duas na mesma
 * coluna faria o numero mudar de significado conforme o recuo.
 */
function Fatia({ valor, total }: { valor: number; total: number }) {
  if (total === 0) return <>—</>;
  const fatia = (valor / total) * 100;
  // Abaixo de 0,05% arredondaria para 0,0%, que se le como "nada".
  return (
    <>{fatia > 0 && fatia < 0.05 ? "<0,1%" : `${formatPercent(fatia)}%`}</>
  );
}

function Lucro({ valor }: { valor: number | null }) {
  if (valor === null) return <>—</>;
  return (
    <span className={valor < 0 ? "negative" : "positive"}>
      {formatBRL(valor)}
    </span>
  );
}

export function TabelaDePapeis({ posicoes }: { posicoes: PapelNaCarteira[] }) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());

  const classes = agruparPorClasse(posicoes);
  const total = classes.reduce((s, c) => s + c.saldo, 0);
  const comLucro = classes.filter((c) => c.lucro !== null);
  const lucro = comLucro.length
    ? comLucro.reduce((s, c) => s + (c.lucro ?? 0), 0)
    : null;

  function alternar(chave: string) {
    setAbertos((atuais) => {
      const proximo = new Set(atuais);
      if (!proximo.delete(chave)) proximo.add(chave);
      return proximo;
    });
  }

  if (classes.length === 0) return null;

  return (
    <figure className="gr">
      <figcaption className="gr-titulo">
        Carteira · por classe, abrindo em instrumento e custodia
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
              <th scope="col" className="gr-num">
                <span className="gr-so-largo">Patrimonio</span>
                <span className="gr-so-estreito">%</span>
              </th>
            </tr>
          </thead>

          {classes.map((classe) => {
            // Uma classe com um instrumento so nao tem o que revelar: o nivel
            // de baixo repetiria a linha de cima com outro recuo.
            const abreClasse = classe.instrumentos.length > 1;
            const classeAberta = abertos.has(classe.nome);
            const unico = abreClasse ? null : classe.instrumentos[0];

            return (
              <tbody
                key={classe.nome}
                className={classeAberta ? "gr-grupo aberto" : "gr-grupo"}
              >
                <tr>
                  <th scope="row">
                    {abreClasse ? (
                      <button
                        type="button"
                        className="gr-abrir"
                        onClick={() => alternar(classe.nome)}
                        aria-expanded={classeAberta}
                      >
                        <Seta aberto={classeAberta} />
                        <span className="gr-rotulo">
                          {classe.nome}
                          <span className="gr-badge">
                            {classe.instrumentos.length}
                          </span>
                        </span>
                      </button>
                    ) : (
                      // Uma classe com um instrumento so E aquele instrumento.
                      // Escrever "FIDC" no lugar de "Green FIDC Solar GD"
                      // trocaria o nome do papel por um rotulo que nao
                      // acrescenta nada.
                      <>
                        {unico?.manual ? (
                          <MarcaManual avaliadoEm={unico.avaliadoEm} />
                        ) : null}
                        {unico?.nome ?? classe.nome}
                        <span className="account-meta">
                          {" "}
                          · {unico?.instituicao}
                        </span>
                        {unico && unico.posicoes > 1 ? (
                          <span
                            className="gr-badge"
                            title={`${unico.posicoes} posicoes somadas`}
                          >
                            {unico.posicoes}
                          </span>
                        ) : null}
                      </>
                    )}
                  </th>
                  <td className="gr-so-largo">
                    <span className="gr-data">
                      {classe.vence
                        ? dataCompleta(classe.vence)
                        : unico?.manual && unico.avaliadoEm
                          ? `avaliado em ${dataCompleta(unico.avaliadoEm)}`
                          : "—"}
                    </span>
                  </td>
                  <td className="gr-num gr-so-largo">
                    <Taxa
                      valor={classe.taxa}
                      marcada={
                        abreClasse ? null : classe.instrumentos[0]?.taxaMarcada
                      }
                      marcadaEm={classe.instrumentos[0]?.taxaMarcadaEm}
                    />
                  </td>
                  <td className="gr-num gr-so-largo">
                    <Lucro valor={classe.lucro} />
                  </td>
                  <td className="gr-num">{formatBRL(classe.saldo)}</td>
                  <td className="gr-num">
                    <Fatia valor={classe.saldo} total={total} />
                  </td>
                </tr>

                {abreClasse && classeAberta
                  ? classe.instrumentos.flatMap((papel) => {
                      const varias = papel.custodias.length > 1;
                      const chave = `${classe.nome}/${papel.id}`;
                      const papelAberto = abertos.has(chave);

                      const rotulo = (
                        <>
                          {papel.manual ? (
                            <MarcaManual avaliadoEm={papel.avaliadoEm} />
                          ) : null}
                          {papel.nome}
                          <span className="account-meta">
                            {" "}
                            · {papel.instituicao}
                          </span>
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

                      return [
                        <tr key={chave} className="gr-nivel-2">
                          <th scope="row">
                            {varias ? (
                              <button
                                type="button"
                                className="gr-abrir"
                                onClick={() => alternar(chave)}
                                aria-expanded={papelAberto}
                              >
                                <Seta aberto={papelAberto} />
                                <span className="gr-rotulo">{rotulo}</span>
                              </button>
                            ) : (
                              rotulo
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
                          <td className="gr-num">
                            <Fatia valor={papel.saldo} total={total} />
                          </td>
                        </tr>,

                        ...(varias && papelAberto
                          ? papel.custodias.map((custodia) => (
                              <tr
                                key={`${chave}/${custodia.instituicao}`}
                                className="gr-nivel-3"
                              >
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
                                  {papel.taxaMarcada &&
                                  custodia.taxa === null ? null : (
                                    <Taxa valor={custodia.taxa} />
                                  )}
                                </td>
                                <td className="gr-num gr-so-largo">
                                  <Lucro valor={custodia.lucro} />
                                </td>
                                <td className="gr-num">
                                  {formatBRL(custodia.saldo)}
                                </td>
                                <td className="gr-num">
                                  <Fatia valor={custodia.saldo} total={total} />
                                </td>
                              </tr>
                            ))
                          : []),
                      ];
                    })
                  : null}
              </tbody>
            );
          })}

          {/* O total fecha a tabela porque agora ela e a unica: sem os dois
              resumos que vinham antes, a soma precisa estar em algum lugar. */}
          <tfoot>
            <tr className="gr-total">
              <th scope="row">Total</th>
              <td className="gr-so-largo" />
              <td className="gr-num gr-so-largo" />
              <td className="gr-num gr-so-largo">
                <Lucro valor={lucro} />
              </td>
              <td className="gr-num">{formatBRL(total)}</td>
              <td className="gr-num">
                {total > 0 ? `${formatPercent(100)}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}
