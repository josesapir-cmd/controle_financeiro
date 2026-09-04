import {
  adicionarChamada,
  adicionarCompromisso,
  alternarCompromisso,
  editarCompromisso,
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
 * Sem dependencia de mes nem de conta: a fita de meses acima nao mexe nesta
 * aba, porque um compromisso de cinco anos nao pertence a agosto.
 */

function porcento(fracao: number): string {
  return `${(fracao * 100).toFixed(0)}%`;
}

function Barra({ fracao, excedido }: { fracao: number; excedido: boolean }) {
  return (
    <span className={excedido ? "cp-barra excedida" : "cp-barra"} aria-hidden>
      <span style={{ width: `${Math.max(1, fracao * 100)}%` }} />
    </span>
  );
}

export function Compromissos({ carteira }: { carteira: CarteiraDeCompromissos }) {
  const hoje = localDay(new Date());
  const { fundos } = carteira;
  const chamadoTotal =
    carteira.comprometido > 0 ? carteira.chamado / carteira.comprometido : 0;

  return (
    <>
      {/* O total primeiro: e o numero de exposicao, e ele muda a decisao de
          quanto caixa deixar parado. */}
      <section className="card cp-resumo">
        <div>
          <div className="tile-label">Ainda a chamar</div>
          <div className="tile-value">{formatBRL(carteira.aChamar)}</div>
          <div className="tile-note">
            {fundos.length} {fundos.length === 1 ? "fundo" : "fundos"} · {formatBRL(carteira.chamado)}{" "}
            ja chamado de {formatBRL(carteira.comprometido)} ({porcento(chamadoTotal)})
          </div>
        </div>
        <div className="cp-resumo-barra">
          <Barra fracao={chamadoTotal} excedido={false} />
        </div>
      </section>

      {fundos.length === 0 ? (
        <p className="empty">
          Nenhum compromisso cadastrado. Adicione o primeiro no formulario abaixo.
        </p>
      ) : null}

      {fundos.map((fundo) => (
        <section key={fundo.id} className="gr cp-fundo">
          <header className="cp-cabecalho">
            <div>
              <h3 className="cp-nome">{fundo.nome}</h3>
              <span className="account-meta">
                {[
                  fundo.assinadoEm ? `assinado em ${dataCompleta(fundo.assinadoEm)}` : null,
                  `${fundo.chamadas.length} ${fundo.chamadas.length === 1 ? "chamada" : "chamadas"}`,
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

          <Barra fracao={fundo.fatiaChamada} excedido={fundo.excedido} />

          {/* Estourar o compromisso acontece de verdade (taxa cobrada acima
              dele, ou valor digitado errado) e precisa ser dito, nao escondido
              num "a chamar" zerado. */}
          {fundo.excedido ? (
            <p className="cp-aviso">
              As chamadas somam {formatBRL(fundo.chamado - fundo.comprometido)} acima do
              compromisso. Confira os valores ou aumente o compromisso.
            </p>
          ) : null}

          {fundo.chamadas.length > 0 ? (
            <div className="gr-rolagem">
              <table className="gr-tabela cp-chamadas">
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col" className="gr-num">
                      Valor
                    </th>
                    {/* No celular o acumulado sai: e derivavel da coluna ao
                        lado, e mante-lo empurra o "remover" para fora da tela. */}
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
                  {fundo.chamadas.map((chamada) => (
                    <tr key={chamada.id}>
                      <th scope="row">
                        {dataCompleta(chamada.data)}
                        {chamada.nota ? (
                          <span className="account-meta"> · {chamada.nota}</span>
                        ) : null}
                      </th>
                      <td className="gr-num">{formatBRL(chamada.valor)}</td>
                      <td className="gr-num gr-so-largo">{formatBRL(chamada.acumulado)}</td>
                      <td className="cp-acao">
                        <form action={removerChamada}>
                          <input type="hidden" name="id" value={chamada.id} />
                          <button type="submit" className="cp-remover">
                            remover
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
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
      ))}

      <section className="gr">
        <h3 className="cp-nome">Novo compromisso</h3>
        <form action={adicionarCompromisso} className="cp-linha">
          <label className="cp-cresce">
            Fundo
            <input type="text" name="name" placeholder="Nome do fundo" required />
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
    </>
  );
}
