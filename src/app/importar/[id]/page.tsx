import { notFound } from "next/navigation";
import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { lerImportacao } from "@/lib/db/repository";
import { formatBRL } from "@/lib/finance/money";
import { classificarParaConferencia } from "@/lib/importacao/linhas";
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
export default async function Conferir({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();

  const { id } = await params;
  const lote = await lerImportacao(fromPostgres(getSql()), id);
  if (!lote) notFound();

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

      {lote.linhas.length === 0 ? (
        <section className="card">
          <p className="empty">
            Nenhum lancamento foi reconhecido nas imagens. Verifique se o print e da tela de
            extrato do saldo compartilhado e tente de novo.
          </p>
        </section>
      ) : (
        <form action={confirmarImportacao}>
          <input type="hidden" name="id" value={lote.id} />
          <input type="hidden" name="indices" value={indices} />

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
