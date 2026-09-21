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
 * A taxa colada no nome: "CDB BTG 2027 @ 13,45%".
 *
 * Deixou de ser coluna porque so renda fixa tem taxa — uma coluna inteira de
 * tracos para os fundos custava mais largura do que informava. No nome ela
 * aparece exatamente onde existe.
 *
 * E sempre a CONTRATADA na compra, a que a instituicao informa: o que se recebe
 * levando ao vencimento. A taxa de hoje — a que se recebe vendendo agora — nao
 * aparece aqui, porque nao ha de onde busca-la sem alguem digitar, e taxa
 * digitada envelhece em dias sem nenhum sinal ao lado de um saldo de hoje.
 */
function Taxa({ valor }: { valor?: number | null }) {
  if (valor === null || valor === undefined) return null;

  return (
    <span className="gr-taxa" title="Taxa contratada na compra">
      {" @ "}
      {formatPercent(valor, 2)}%
    </span>
  );
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

export function TabelaDePapeis({
  posicoes,
  vistoEm,
}: {
  posicoes: PapelNaCarteira[];
  /** Quando a posicao mais antiga foi vista na corretora. */
  vistoEm?: Date | null;
}) {
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  const classes = agruparPorClasse(posicoes);
  const total = classes.reduce((s, c) => s + c.saldo, 0);
  const totalLiquido = classes.reduce((s, c) => s + c.liquido, 0);

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
        <span>Carteira · por classe, abrindo em instrumento e custodia</span>

        {/* Um valor de carteira sem data parece sempre de hoje. Esta e a
            unica coisa do cartao de resumo que nao podia sair com ele. */}
        {vistoEm ? (
          <span className="account-meta">
            posicao de {dataCompleta(vistoEm.toISOString().slice(0, 10))}
          </span>
        ) : null}
      </figcaption>

      <div className="gr-rolagem">
        <table className="gr-tabela gr-arvore">
          <thead>
            <tr>
              <th scope="col">Instrumento</th>
              <th scope="col" className="gr-num">
                Bruto
              </th>
              <th scope="col" className="gr-num">
                %
              </th>
              <th scope="col" className="gr-num">
                Liquido
              </th>
              <th scope="col" className="gr-num">
                %
              </th>
            </tr>
          </thead>

          {classes.map((classe) => {
            // Uma classe com um instrumento so normalmente nao tem o que
            // revelar: o nivel de baixo repetiria a linha de cima com outro
            // recuo. Mas se esse instrumento esta em mais de uma custodia, o
            // detalhe existe — e sem botao aqui ele ficava inalcancavel,
            // porque o nivel que o mostraria nunca era desenhado.
            const unico =
              classe.instrumentos.length === 1 ? classe.instrumentos[0] : null;
            const abreClasse =
              classe.instrumentos.length > 1 ||
              (unico?.custodias.length ?? 0) > 1;
            const classeAberta = abertos.has(classe.nome);

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
                          {/* Com um instrumento so, o nome dele e o da linha:
                              "FIDC" no lugar de "Green FIDC Solar GD" trocaria
                              o nome do papel por um rotulo. */}
                          {unico?.nome ?? classe.nome}
                          <Taxa valor={unico?.taxa ?? classe.taxa} />
                          <span className="gr-badge">
                            {unico
                              ? unico.custodias.length
                              : classe.instrumentos.length}
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
                        <Taxa valor={unico?.taxa} />
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
                  <td className="gr-num">{formatBRL(classe.saldo)}</td>
                  <td className="gr-num">
                    <Fatia valor={classe.saldo} total={total} />
                  </td>
                  <td className="gr-num">{formatBRL(classe.liquido)}</td>
                  <td className="gr-num">
                    <Fatia valor={classe.liquido} total={totalLiquido} />
                  </td>
                </tr>

                {/* Instrumento unico: o nivel do meio seria a linha de cima
                    repetida, entao a classe abre direto nas custodias. */}
                {classeAberta && unico
                  ? unico.custodias.map((custodia) => (
                      <tr
                        key={`${classe.nome}/${custodia.instituicao}`}
                        className="gr-nivel-2"
                      >
                        <th scope="row">
                          {custodia.instituicao}
                          {custodia.posicoes > 1 ? (
                            <span className="gr-badge">
                              {custodia.posicoes}
                            </span>
                          ) : null}
                        </th>
                        <td className="gr-num">{formatBRL(custodia.saldo)}</td>
                        <td className="gr-num">
                          <Fatia valor={custodia.saldo} total={total} />
                        </td>
                        <td className="gr-num">
                          {formatBRL(custodia.liquido)}
                        </td>
                        <td className="gr-num">
                          <Fatia
                            valor={custodia.liquido}
                            total={totalLiquido}
                          />
                        </td>
                      </tr>
                    ))
                  : null}

                {abreClasse && classeAberta && !unico
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
                          <Taxa valor={papel.taxa} />
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
                          <td className="gr-num">{formatBRL(papel.saldo)}</td>
                          <td className="gr-num">
                            <Fatia valor={papel.saldo} total={total} />
                          </td>
                          <td className="gr-num">
                            {formatBRL(papel.liquido ?? papel.saldo)}
                          </td>
                          <td className="gr-num">
                            <Fatia
                              valor={papel.liquido ?? papel.saldo}
                              total={totalLiquido}
                            />
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
                                <td className="gr-num">
                                  {formatBRL(custodia.saldo)}
                                </td>
                                <td className="gr-num">
                                  <Fatia valor={custodia.saldo} total={total} />
                                </td>
                                <td className="gr-num">
                                  {formatBRL(custodia.liquido)}
                                </td>
                                <td className="gr-num">
                                  <Fatia
                                    valor={custodia.liquido}
                                    total={totalLiquido}
                                  />
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
              <td className="gr-num">{formatBRL(total)}</td>
              <td className="gr-num">
                {total > 0 ? `${formatPercent(100)}%` : "—"}
              </td>
              <td className="gr-num">{formatBRL(totalLiquido)}</td>
              <td className="gr-num">
                {totalLiquido > 0 ? `${formatPercent(100)}%` : "—"}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </figure>
  );
}
