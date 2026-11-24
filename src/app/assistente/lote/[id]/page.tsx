import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAcessoDaAssistente } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { lerImportacao } from "@/lib/db/repository";
import { formatBRL } from "@/lib/finance/money";
import { classificarParaConferencia } from "@/lib/importacao/linhas";
import { LinhasEditaveis, type LinhaComIndice } from "../../../importar/[id]/LinhasEditaveis";
import { confirmarLote, descartarLote } from "../../actions";

export const dynamic = "force-dynamic";

/**
 * Conferencia de um lote de prints, na versao da assistente.
 *
 * As mesmas linhas e os mesmos tres blocos da conferencia do dono — repetidas
 * entre envios desmarcadas, leitura incerta marcada para bater, o resto
 * fechado. O que fica de fora sao as telas de pedido: casa-las e procurar a
 * cobranca no cartao do dono, e essa tela nao mostra cartao nenhum.
 */
export default async function ConferirLote({ params }: { params: Promise<{ id: string }> }) {
  const papel = await requireAcessoDaAssistente();

  const { id } = await params;
  const lote = await lerImportacao(fromPostgres(getSql()), id);
  if (!lote) notFound();

  const comIndice: LinhaComIndice[] = lote.linhas.map((linha, indice) => ({ linha, indice }));
  const { decidir, conferir, prontas } = classificarParaConferencia(
    comIndice.map((item) => ({ ...item, ...item.linha })),
  );

  const valendo = [...conferir, ...prontas].map((i) => i.linha);
  const saidas = valendo.reduce((t, l) => (l.valor < 0 ? t - l.valor : t), 0);
  const pendente = lote.status === "pendente";
  const indices = lote.linhas.map((_, i) => String(i)).join(",");

  return (
    <main className={papel === "dono" ? "page" : "page sem-menu"}>
      <div className="masthead">
        <h1>Conferir prints</h1>
        <span className="period">
          <Link href="/assistente">Voltar</Link>
        </span>
      </div>

      {!pendente ? (
        <p className="banner">
          <strong>Este envio ja foi {lote.status}.</strong> Nada aqui pode ser alterado.
        </p>
      ) : (
        <p className="banner">
          <strong>Nada foi gravado ainda.</strong> Os valores foram lidos das imagens e podem ter
          erro: confira data, descricao e valor antes de lancar. Desmarque o que nao for gasto.
        </p>
      )}

      {lote.pedidos.length > 0 ? (
        <p className="banner">
          Este envio tambem tinha {lote.pedidos.length}{" "}
          {lote.pedidos.length === 1 ? "tela de pedido" : "telas de pedido"} (Amazon, Mercado
          Livre…). Essas ficam de fora aqui — so as linhas do saldo compartilhado sao lancadas.
        </p>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Gastos a lancar</div>
          <div className="tile-value negative">{formatBRL(-saidas)}</div>
          <div className="tile-note">
            {valendo.length} {valendo.length === 1 ? "linha marcada" : "linhas marcadas"}
          </div>
        </div>
      </div>

      {lote.linhas.length === 0 ? (
        <section className="card">
          <p className="empty">
            Nada foi reconhecido nas imagens. Confira se o print e da tela do saldo compartilhado
            do Nubank e envie de novo.
          </p>
        </section>
      ) : (
        <form action={confirmarLote}>
          <input type="hidden" name="id" value={lote.id} />
          <input type="hidden" name="indices" value={indices} />

          {decidir.length > 0 ? (
            <section className="bloco-decidir">
              <h2>Repetidas entre envios ({decidir.length})</h2>
              <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
                Mesma data, valor e descricao de uma linha de outro print. Pode ser o mesmo gasto
                fotografado duas vezes, ou dois gastos iguais.{" "}
                <strong>Marque so as que forem gastos separados.</strong>
              </p>
              <div className="card">
                <LinhasEditaveis itens={decidir} incluirPorPadrao={false} />
              </div>
            </section>
          ) : null}

          {conferir.length > 0 ? (
            <section className="bloco-conferir">
              <h2>Leitura incerta ({conferir.length})</h2>
              <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
                Bata o valor contra o print e corrija se precisar.
              </p>
              <div className="card">
                <LinhasEditaveis itens={conferir} incluirPorPadrao />
              </div>
            </section>
          ) : null}

          {prontas.length > 0 ? (
            <section>
              <h2>Lidas com confianca alta ({prontas.length})</h2>
              <details className="bloco-prontas">
                <summary>
                  <span className="description">ja marcadas</span>
                  <span className="account-meta">abrir para revisar linha a linha</span>
                </summary>
                <div className="card" style={{ marginTop: 12 }}>
                  <LinhasEditaveis itens={prontas} incluirPorPadrao mostrarOrigem={false} />
                </div>
              </details>
            </section>
          ) : null}

          {pendente ? (
            <div className="acoes-conferencia">
              <button type="submit">Lancar gastos</button>
              <span className="account-meta">
                Depois de lancar, eles aparecem na sua tela para classificar.
              </span>
            </div>
          ) : null}
        </form>
      )}

      {pendente ? (
        <form action={descartarLote} style={{ marginTop: 12 }}>
          <input type="hidden" name="id" value={lote.id} />
          <button type="submit" className="danger">
            Descartar este envio
          </button>
        </form>
      ) : null}
    </main>
  );
}
