"use client";

import { useState } from "react";
import {
  adicionarChamada,
  adicionarCompromisso,
  alternarCompromisso,
  editarChamada,
  editarCompromisso,
  liquidar,
  removerChamada,
} from "@/app/actions";
import { dataCompleta, localDay } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { CarteiraDeCompromissos } from "@/lib/finance/compromissos";

/**
 * Compromissos de capital em fundos.
 *
 * Um compromisso e uma promessa de dinheiro que ainda nao saiu: assina-se o
 * total e o gestor chama pedacos quando quer, sem calendario. A tela e
 * organizada em volta da pergunta que isso cria — quanto ainda pode ser
 * chamado de surpresa — e nao em volta do que ja foi pago, que o extrato ja
 * mostra.
 *
 * A lista das chamadas fica fechada por padrao. Ela e historico: quem abre a
 * tela quer o saldo, e so desce ao detalhe quando alguma coisa nao bate. A
 * linha de resumo carrega o que se olha sempre.
 *
 * Sem dependencia de mes nem de conta: a fita de meses acima nao mexe nesta
 * aba, porque um compromisso de cinco anos nao pertence a agosto.
 */

function porcento(fracao: number): string {
  return `${(fracao * 100).toFixed(0)}%`;
}

/**
 * A barra do compromisso, em dois pedacos.
 *
 * O que ja foi pago e faixa cheia; o que foi chamado e ainda nao saiu e
 * pontilhado laranja — a textura diz "prometido, nao entregue" sem depender de
 * distinguir duas cores, e o valor aparece escrito na linha de resumo logo
 * abaixo, entao a informacao nunca esta so na cor.
 *
 * A base e o maior entre compromisso e chamado: quando as chamadas passam do
 * compromisso a barra enche por inteiro, e as duas partes continuam
 * proporcionais entre si em vez de uma delas sumir no arredondamento.
 */
function Barra({
  liquidado,
  aLiquidar,
  comprometido,
  excedido,
}: {
  liquidado: number;
  aLiquidar: number;
  comprometido: number;
  excedido: boolean;
}) {
  const base = Math.max(comprometido, liquidado + aLiquidar, 1);
  const largura = (valor: number) => `${(valor / base) * 100}%`;

  return (
    <span className={excedido ? "cp-barra excedida" : "cp-barra"} aria-hidden>
      {liquidado > 0 ? <span className="cp-pago" style={{ width: largura(liquidado) }} /> : null}
      {aLiquidar > 0 ? (
        <span className="cp-aguardando" style={{ width: largura(aLiquidar) }} />
      ) : null}
    </span>
  );
}

/** Marca de conferido: desenhada, para nao depender de fonte de icone. */
function Tique() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 13l4 4L19 7" />
    </svg>
  );
}

export function Compromissos({ carteira }: { carteira: CarteiraDeCompromissos }) {
  const hoje = localDay(new Date());
  const { fundos } = carteira;
  const chamadoTotal =
    carteira.comprometido > 0 ? carteira.chamado / carteira.comprometido : 0;

  const [cadastrando, setCadastrando] = useState(false);
  const [abertos, setAbertos] = useState<ReadonlySet<string>>(new Set());
  /** Chamada em edicao. Uma por vez: duas linhas abertas nao ajudam ninguem. */
  const [editando, setEditando] = useState<string | null>(null);

  function alternarLista(id: string) {
    setAbertos((atuais) => {
      const proximo = new Set(atuais);
      if (!proximo.delete(id)) proximo.add(id);
      return proximo;
    });
  }

  return (
    <>
      {/* O total primeiro: e o numero de exposicao, e ele muda a decisao de
          quanto caixa deixar parado. */}
      <section className="card cp-resumo">
        <div>
          <div className="tile-label">Ainda a chamar</div>
          <div className="tile-value">{formatBRL(carteira.aChamar)}</div>
          <div className="tile-note">
            {fundos.length} {fundos.length === 1 ? "fundo" : "fundos"} ·{" "}
            {formatBRL(carteira.chamado)} ja chamado de {formatBRL(carteira.comprometido)} (
            {porcento(chamadoTotal)})
            {carteira.aLiquidar > 0
              ? ` · ${formatBRL(carteira.aLiquidar)} aguardando liquidacao`
              : ""}
          </div>
        </div>

        <div className="cp-resumo-barra">
          <Barra
            liquidado={carteira.liquidado}
            aLiquidar={carteira.aLiquidar}
            comprometido={carteira.comprometido}
            excedido={false}
          />
        </div>

        <button
          type="button"
          className="cp-novo"
          onClick={() => setCadastrando(true)}
          disabled={cadastrando}
        >
          Novo compromisso
        </button>
      </section>

      {/* Fundo amarelo e o que diz "isto e um rascunho, ainda nao existe": o
          bloco entra por cima da lista e sai sem deixar rastro. */}
      {cadastrando ? (
        <section className="gr cp-rascunho">
          <div className="cp-rascunho-topo">
            <h3 className="cp-nome">Novo compromisso</h3>
            <button
              type="button"
              className="cp-fechar"
              onClick={() => setCadastrando(false)}
              aria-label="Fechar"
            >
              ×
            </button>
          </div>

          <form action={adicionarCompromisso} className="cp-linha">
            <label className="cp-cresce">
              Fundo
              <input type="text" name="name" placeholder="Nome do fundo" required autoFocus />
            </label>
            <label>
              Compromisso
              <input
                type="text"
                name="committed"
                inputMode="decimal"
                placeholder="500.000,00"
                required
              />
            </label>
            <label>
              Assinado em
              <input type="date" name="signedOn" />
            </label>
            <label className="cp-cresce">
              Nota
              <input type="text" name="note" placeholder="opcional" />
            </label>
            <button type="submit">Adicionar</button>
          </form>
        </section>
      ) : null}

      {fundos.length === 0 && !cadastrando ? (
        <p className="empty">
          Nenhum compromisso cadastrado. Use <strong>Novo compromisso</strong> para cadastrar o
          primeiro.
        </p>
      ) : null}

      {fundos.map((fundo) => {
        const aberto = abertos.has(fundo.id);

        return (
          <section key={fundo.id} className="gr cp-fundo">
            <header className="cp-cabecalho">
              <div>
                <h3 className="cp-nome">{fundo.nome}</h3>
                <span className="account-meta">
                  {[
                    fundo.assinadoEm ? `assinado em ${dataCompleta(fundo.assinadoEm)}` : null,
                    fundo.nota,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </div>

              <div className="cp-numeros">
                <div>
                  <span className="tile-label">A chamar</span>
                  <strong className="cp-destaque">{formatBRL(fundo.aChamar)}</strong>
                </div>
                <div>
                  <span className="tile-label">Chamado</span>
                  <strong>
                    {formatBRL(fundo.chamado)}{" "}
                    <span className="account-meta">({porcento(fundo.fatiaChamada)})</span>
                  </strong>
                </div>
                <div>
                  <span className="tile-label">Compromisso</span>
                  <strong>{formatBRL(fundo.comprometido)}</strong>
                </div>
              </div>
            </header>

            <Barra
              liquidado={fundo.liquidado}
              aLiquidar={fundo.aLiquidar}
              comprometido={fundo.comprometido}
              excedido={fundo.excedido}
            />

            {/* Estourar o compromisso acontece de verdade (taxa cobrada acima
                dele, ou valor digitado errado) e precisa ser dito, nao escondido
                num "a chamar" zerado. */}
            {fundo.excedido ? (
              <p className="cp-aviso">
                As chamadas somam {formatBRL(fundo.chamado - fundo.comprometido)} acima do
                compromisso. Confira os valores ou aumente o compromisso.
              </p>
            ) : null}

            <button
              type="button"
              className="cp-sumario"
              onClick={() => alternarLista(fundo.id)}
              aria-expanded={aberto}
              disabled={fundo.chamadas.length === 0}
            >
              <span className={aberto ? "gr-seta aberta" : "gr-seta"} aria-hidden />
              {fundo.chamadas.length === 0 ? (
                <span>Nenhuma chamada registrada</span>
              ) : (
                <span>
                  <strong>{formatBRL(fundo.liquidado)}</strong> ({porcento(
                    fundo.comprometido > 0 ? fundo.liquidado / fundo.comprometido : 0,
                  )}
                  ) investidos em {fundo.chamadas.length}{" "}
                  {fundo.chamadas.length === 1 ? "chamada de capital" : "chamadas de capital"}
                  {fundo.aLiquidar > 0 ? (
                    <span className="cp-pendente">
                      {" "}
                      · {formatBRL(fundo.aLiquidar)} a liquidar
                    </span>
                  ) : null}
                </span>
              )}
            </button>

            {aberto && fundo.chamadas.length > 0 ? (
              <div className="gr-rolagem">
                <table className="gr-tabela cp-chamadas">
                  <thead>
                    <tr>
                      <th scope="col" className="cp-acao">
                        <span className="cp-oculto">Liquidada</span>
                      </th>
                      <th scope="col">Data</th>
                      <th scope="col" className="gr-num">
                        Valor
                      </th>
                      <th scope="col" className="gr-num gr-so-largo">
                        Acumulado
                      </th>
                      <th scope="col" className="cp-acao" />
                    </tr>
                  </thead>
                  <tbody>
                    {/* Em ordem cronologica, com o acumulado ao lado: e assim
                        que se le "a que altura do compromisso esta chamada
                        chegou". */}
                    {fundo.chamadas.map((chamada) =>
                      editando === chamada.id ? (
                        <tr key={chamada.id} className="cp-editando">
                          <td colSpan={5}>
                            <form
                              action={editarChamada}
                              className="cp-linha"
                              onSubmit={() => setEditando(null)}
                            >
                              <input type="hidden" name="id" value={chamada.id} />
                              <label>
                                Data
                                <input
                                  type="date"
                                  name="calledOn"
                                  defaultValue={chamada.data}
                                  required
                                />
                              </label>
                              <label>
                                Valor
                                <input
                                  type="text"
                                  name="amount"
                                  inputMode="decimal"
                                  defaultValue={chamada.valor.toFixed(2).replace(".", ",")}
                                  required
                                />
                              </label>
                              <label className="cp-cresce">
                                Nota
                                <input
                                  type="text"
                                  name="note"
                                  defaultValue={chamada.nota ?? ""}
                                  placeholder="opcional"
                                />
                              </label>
                              <button type="submit">Salvar</button>
                              <button
                                type="button"
                                className="cp-cancelar"
                                onClick={() => setEditando(null)}
                              >
                                cancelar
                              </button>

                              {/* Mesmo formulario, outra acao: `formAction` e o
                                  jeito de ter dois destinos num `form` so —
                                  aninhar formularios nao existe em HTML, e o
                                  botao de apagar precisa dos campos deste. */}
                              <button
                                type="submit"
                                formAction={removerChamada}
                                className="cp-x"
                                aria-label={`Apagar a chamada de ${dataCompleta(chamada.data)}`}
                                title="Apagar esta chamada"
                              >
                                ×
                              </button>
                            </form>
                          </td>
                        </tr>
                      ) : (
                        <tr key={chamada.id}>
                          <td className="cp-acao">
                            <form action={liquidar}>
                              <input type="hidden" name="id" value={chamada.id} />
                              {chamada.liquidada ? (
                                <input type="hidden" name="desfazer" value="sim" />
                              ) : null}
                              <button
                                type="submit"
                                className={chamada.liquidada ? "cp-tique feito" : "cp-tique"}
                                aria-pressed={chamada.liquidada}
                                aria-label={
                                  chamada.liquidada
                                    ? "Marcar como nao liquidada"
                                    : "Marcar como liquidada"
                                }
                                title={chamada.liquidada ? "Liquidada" : "Aguardando liquidacao"}
                              >
                                <Tique />
                              </button>
                            </form>
                          </td>
                          <th scope="row" className={chamada.liquidada ? "" : "cp-aberta"}>
                            {dataCompleta(chamada.data)}
                            {chamada.nota ? (
                              <span className="account-meta"> · {chamada.nota}</span>
                            ) : null}
                            {chamada.liquidada ? null : (
                              <span className="cp-etiqueta">a liquidar</span>
                            )}
                          </th>
                          <td className="gr-num">{formatBRL(chamada.valor)}</td>
                          <td className="gr-num gr-so-largo">{formatBRL(chamada.acumulado)}</td>
                          <td className="cp-acao">
                            <button
                              type="button"
                              className="cp-remover"
                              onClick={() => setEditando(chamada.id)}
                            >
                              editar
                            </button>
                          </td>
                        </tr>
                      ),
                    )}
                  </tbody>
                </table>
              </div>
            ) : null}

            <form action={adicionarChamada} className="cp-linha">
              <input type="hidden" name="commitmentId" value={fundo.id} />
              <label>
                Data
                <input type="date" name="calledOn" defaultValue={hoje} required />
              </label>
              <label>
                Valor
                <input
                  type="text"
                  name="amount"
                  inputMode="decimal"
                  placeholder="50.000,00"
                  required
                />
              </label>
              <label className="cp-cresce">
                Nota
                <input type="text" name="note" placeholder="opcional" />
              </label>
              <button type="submit">Registrar chamada</button>
            </form>

            {/* Editar e encerrar ficam fechados: sao raros perto de registrar
                chamada, que e o que se faz nesta tela toda semana. */}
            <details className="cp-editar">
              <summary>Editar compromisso</summary>
              <form action={editarCompromisso} className="cp-linha">
                <input type="hidden" name="id" value={fundo.id} />
                <label className="cp-cresce">
                  Fundo
                  <input type="text" name="name" defaultValue={fundo.nome} required />
                </label>
                <label>
                  Compromisso
                  <input
                    type="text"
                    name="committed"
                    inputMode="decimal"
                    defaultValue={fundo.comprometido.toFixed(2).replace(".", ",")}
                    required
                  />
                </label>
                <label>
                  Assinado em
                  <input type="date" name="signedOn" defaultValue={fundo.assinadoEm ?? ""} />
                </label>
                <label className="cp-cresce">
                  Nota
                  <input type="text" name="note" defaultValue={fundo.nota ?? ""} />
                </label>
                <button type="submit">Salvar</button>
              </form>

              <form action={alternarCompromisso} className="cp-linha">
                <input type="hidden" name="id" value={fundo.id} />
                {fundo.encerrado ? <input type="hidden" name="reabrir" value="sim" /> : null}
                <button type="submit" className="cp-remover">
                  {fundo.encerrado ? "Reabrir compromisso" : "Encerrar compromisso"}
                </button>
                <span className="account-meta">
                  Encerrar tira o fundo da lista sem apagar nenhuma chamada.
                </span>
              </form>
            </details>
          </section>
        );
      })}
    </>
  );
}
