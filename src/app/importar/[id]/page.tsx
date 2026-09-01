import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { lerImportacao, listTransactions } from "@/lib/db/repository";
import { shiftDay } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { classificarParaConferencia } from "@/lib/importacao/linhas";
import { casarPedidos, type Casamento, type Cobranca, type Pedido } from "@/lib/importacao/pedidos";
import { confirmarImportacao, descartarImportacao } from "../actions";
import { LinhasEditaveis, type LinhaComIndice } from "./LinhasEditaveis";

export const dynamic = "force-dynamic";

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Conferencia das linhas lidas de prints do saldo compartilhado.
 *
 * Existe porque leitura de imagem erra, e um numero errado no painel e pior do
 * que um numero ausente: uma vez gravado, ele se mistura ao extrato do banco e
 * ninguem mais sabe distinguir.
 *
 * A tela e ordenada por quanto trabalho cada linha exige, nao pela ordem em que
 * foi lida. Sao tres blocos:
 *
 * 1. **Decidir** — repetidas entre envios. So quem viu as telas sabe se sao a
 *    mesma compra fotografada duas vezes ou duas compras iguais. Vem
 *    desmarcadas e ficam fora dos totais ate serem marcadas.
 * 2. **Conferir** — lidas com confianca menor que alta. Ja entram, mas vale
 *    bater o valor contra o print.
 * 3. **Conferidas pelo modelo** — o resto. Aparecem somadas, em bloco fechado:
 *    exibir dezenas de linhas sem acao a tomar so afoga as duas primeiras.
 *
 * Os tres estao no mesmo formulario, entao o bloco fechado tambem e enviado.
 */
/**
 * Casa os produtos lidos com as cobrancas que ja existem.
 *
 * O casamento acontece AQUI, na hora de conferir, e nao na leitura: entre subir
 * o print e conferir pode ter havido uma sincronizacao, e a cobranca que
 * faltava passa a existir. Refazer a conta e barato e acha mais.
 */
async function casarComOExtrato(
  db: ReturnType<typeof fromPostgres>,
  pedidos: Pedido[],
): Promise<Casamento[]> {
  if (pedidos.length === 0) return [];

  const dias = pedidos.map((p) => p.dia).sort();
  const linhas = await listTransactions(db, {
    from: shiftDay(dias[0], -3),
    to: shiftDay(dias[dias.length - 1], 11),
  });

  const cobrancas: Cobranca[] = linhas.map((linha) => ({
    id: linha.id,
    dia: linha.localDay,
    valor: linha.amount,
    descricao: linha.description ?? "",
    contraparte: linha.counterpartyName,
  }));

  return casarPedidos(pedidos, cobrancas);
}

export default async function Conferir({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();

  const { id } = await params;
  const db = fromPostgres(getSql());
  const lote = await lerImportacao(db, id);
  if (!lote) notFound();

  const casamentos = await casarComOExtrato(db, lote.pedidos as Pedido[]);
  const casados = casamentos.filter((c) => c.certeza === "exata");
  const semCobranca = casamentos.filter((c) => c.certeza !== "exata");

  const comIndice: LinhaComIndice[] = lote.linhas.map((linha, indice) => ({ linha, indice }));

  const { decidir, conferir, prontas } = classificarParaConferencia(
    comIndice.map((item) => ({ ...item, ...item.linha })),
  );

  // As repetidas ficam fora dos totais: comecam desmarcadas, entao soma-las
  // aqui mostraria um numero que o botao de confirmar nao vai gravar.
  const valendo = [...conferir, ...prontas].map((i) => i.linha);
  const saidas = valendo.reduce((total, l) => (l.valor < 0 ? total - l.valor : total), 0);
  const entradas = valendo.reduce((total, l) => (l.valor > 0 ? total + l.valor : total), 0);

  const saidasProntas = prontas.reduce(
    (total, { linha }) => (linha.valor < 0 ? total - linha.valor : total),
    0,
  );

  const indices = lote.linhas.map((_, i) => String(i)).join(",");
  const pendente = lote.status === "pendente";
  const semTrabalho = decidir.length === 0 && conferir.length === 0;

  return (
    <main className="page">
      <div className="masthead">
        <h1>Conferir leitura</h1>
        <span className="period">
          {lote.images} {lote.images === 1 ? "imagem" : "imagens"} em {lote.envios}{" "}
          {lote.envios === 1 ? "envio" : "envios"} · {quando.format(lote.createdAt)} ·{" "}
          <Link href="/importar">Todas as importacoes</Link>
        </span>
      </div>

      <Nav atual="/conexoes" />

      {!pendente ? (
        <p className="banner">
          <strong>Lote ja {lote.status}.</strong> Nada aqui pode ser alterado — envie novos prints
          em <Link href="/conexoes">Conexoes</Link> se precisar corrigir algo.
        </p>
      ) : semTrabalho && lote.linhas.length > 0 ? (
        <p className="banner">
          <strong>Nada exige sua atencao.</strong> Todas as {lote.linhas.length} linhas foram lidas
          com confianca alta e nenhuma se repete entre envios. Confira o total e confirme.
        </p>
      ) : (
        <p className="banner">
          <strong>Nada foi gravado ainda.</strong> Estes valores foram lidos das imagens por um
          modelo, nao vieram do banco. O que exige decisao esta no topo; o resto ja vem marcado.
        </p>
      )}

      {lote.note ? (
        <p className="banner">
          <strong>Observacao da leitura.</strong> {lote.note}
        </p>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Despesas a lancar</div>
          <div className="tile-value negative">{formatBRL(-saidas)}</div>
          <div className="tile-note">
            {valendo.length} {valendo.length === 1 ? "linha marcada" : "linhas marcadas"}
            {decidir.length > 0 ? ` · ${decidir.length} fora, aguardando decisao` : ""}
          </div>
        </div>
        <div className="card">
          <div className="tile-label">Entradas a lancar</div>
          <div className="tile-value positive">{formatBRL(entradas)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Precisam de voce</div>
          <div className={`tile-value ${decidir.length + conferir.length > 0 ? "negative" : ""}`}>
            {decidir.length + conferir.length}
          </div>
          <div className="tile-note">
            {decidir.length} a decidir · {conferir.length} a conferir
          </div>
        </div>
      </div>

      {lote.linhas.length === 0 && casamentos.length === 0 ? (
        <section className="card">
          <p className="empty">
            Nada foi reconhecido nas imagens. Verifique se o print e da tela do saldo compartilhado
            do Nubank ou de uma lista de pedidos (Amazon, Mercado Livre, Apple) e tente de novo.
          </p>
        </section>
      ) : (
        <form action={confirmarImportacao}>
          <input type="hidden" name="id" value={lote.id} />
          <input type="hidden" name="indices" value={indices} />
          <input
            type="hidden"
            name="produtos"
            value={casados.map((c) => c.pedido.id).join(",")}
          />

          {decidir.length > 0 ? (
            <section className="bloco-decidir">
              <h2>
                Decida: {decidir.length}{" "}
                {decidir.length === 1 ? "linha repetida" : "linhas repetidas"} entre envios
              </h2>
              <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
                Mesma data, mesmo valor e mesma contraparte de uma linha vinda de outro print.
                Pode ser a mesma compra fotografada duas vezes — ou duas compras iguais de verdade.
                A leitura nao distingue os dois casos, e apagar em silencio tiraria dinheiro do seu
                controle. <strong>Marque as que forem gastos separados.</strong>
              </p>
              <div className="card">
                <LinhasEditaveis itens={decidir} incluirPorPadrao={false} />
              </div>
            </section>
          ) : null}

          {conferir.length > 0 ? (
            <section className="bloco-conferir">
              <h2>
                Confira: {conferir.length} {conferir.length === 1 ? "linha" : "linhas"} de leitura
                incerta
              </h2>
              <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
                O modelo leu, mas sem confianca alta — texto borrado, valor parcialmente coberto ou
                linha cortada na borda da imagem. Ja estao marcadas: bata o valor contra o print e
                corrija o que estiver errado.
              </p>
              <div className="card">
                <LinhasEditaveis itens={conferir} incluirPorPadrao />
              </div>
            </section>
          ) : null}

          {prontas.length > 0 ? (
            <section>
              <h2>
                {prontas.length} {prontas.length === 1 ? "linha lida" : "linhas lidas"} com
                confianca alta
              </h2>
              {/* Fechado por padrao: sao as linhas sem acao a tomar. Somadas
                  bastam para conferir o total; abrir e opcional. */}
              <details className="bloco-prontas">
                <summary>
                  <span className="description">{formatBRL(-saidasProntas)} em despesas</span>
                  <span className="account-meta">
                    ja marcadas · abrir para revisar linha a linha
                  </span>
                </summary>
                <div className="card" style={{ marginTop: 12 }}>
                  <LinhasEditaveis itens={prontas} incluirPorPadrao mostrarOrigem={false} />
                </div>
              </details>
            </section>
          ) : null}

          {casamentos.length > 0 ? (
            <section>
              <h2>
                {casamentos.length}{" "}
                {casamentos.length === 1 ? "produto lido" : "produtos lidos"} de telas de pedido
              </h2>
              <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
                Estes NAO viram lancamento: a compra ja chegou pelo cartao. O que falta e o nome do
                produto, que a fatura nao traz — cada linha abaixo se gruda a cobranca que ja
                existe.
              </p>

              {casados.length > 0 ? (
                <div className="card">
                  <ul className="produtos">
                    {casados.map((casamento) => {
                      const cobranca = casamento.candidatas.find(
                        (c) => c.id === casamento.cobrancaId,
                      );

                      return (
                        <li key={casamento.pedido.id} className="produto">
                          <label className="produto-marca">
                            <input
                              type="checkbox"
                              name={`produto_${casamento.pedido.id}`}
                              value={casamento.cobrancaId ?? ""}
                              defaultChecked
                            />
                          </label>
                          <div className="produto-corpo">
                            <span className="description">{casamento.pedido.produto}</span>
                            <div className="account-meta">
                              {casamento.pedido.loja} · {casamento.pedido.dia}
                              {casamento.pedido.referencia
                                ? ` · pedido ${casamento.pedido.referencia}`
                                : ""}
                              {casamento.pedido.confianca !== "alta"
                                ? ` · leitura ${casamento.pedido.confianca}`
                                : ""}
                            </div>
                            <div className="account-meta">
                              gruda em: {cobranca?.descricao} · {cobranca?.dia}
                            </div>
                          </div>
                          <span className="produto-valor">
                            {formatBRL(-casamento.pedido.valor)}
                          </span>
                          <input
                            type="hidden"
                            name={`produto_loja_${casamento.pedido.id}`}
                            value={casamento.pedido.loja}
                          />
                          <input
                            type="hidden"
                            name={`produto_nome_${casamento.pedido.id}`}
                            value={casamento.pedido.produto}
                          />
                          <input
                            type="hidden"
                            name={`produto_ref_${casamento.pedido.id}`}
                            value={casamento.pedido.referencia ?? ""}
                          />
                          <input
                            type="hidden"
                            name={`produto_dia_${casamento.pedido.id}`}
                            value={casamento.pedido.dia}
                          />
                          <input
                            type="hidden"
                            name={`produto_valor_${casamento.pedido.id}`}
                            value={casamento.pedido.valor}
                          />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ) : null}

              {semCobranca.length > 0 ? (
                <div className="card" style={{ marginTop: 12 }}>
                  <p className="empty" style={{ marginTop: 0 }}>
                    {semCobranca.length}{" "}
                    {semCobranca.length === 1 ? "produto ficou" : "produtos ficaram"} sem cobranca
                    para grudar. Nada se perde: refaca a leitura depois da proxima sincronizacao,
                    ou confira se a compra caiu numa conta que voce ainda nao conectou.
                  </p>
                  <ul className="produtos">
                    {semCobranca.map((casamento) => (
                      <li key={casamento.pedido.id} className="produto produto-sem">
                        <div className="produto-corpo">
                          <span className="description">{casamento.pedido.produto}</span>
                          <div className="account-meta">
                            {casamento.pedido.loja} · {casamento.pedido.dia} ·{" "}
                            {casamento.certeza === "ambigua"
                              ? `${casamento.candidatas.length} cobrancas iguais na janela — nao da para escolher sozinho`
                              : "nenhuma cobranca com este valor, nesta loja, nesta janela"}
                          </div>
                        </div>
                        <span className="produto-valor">{formatBRL(-casamento.pedido.valor)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>
          ) : null}

          {pendente ? (
            <div className="acoes-conferencia">
              <button type="submit">Confirmar e lancar</button>
              <span className="account-meta">
                Grava as linhas marcadas na conta virtual do saldo compartilhado.
              </span>
            </div>
          ) : null}
        </form>
      )}

      {pendente ? (
        <form action={descartarImportacao} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={lote.id} />
          <button type="submit" className="danger">
            Descartar leitura
          </button>
        </form>
      ) : null}
    </main>
  );
}
