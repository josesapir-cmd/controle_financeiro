import { notFound } from "next/navigation";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { lerImportacao } from "@/lib/db/repository";
import { formatBRL } from "@/lib/finance/money";
import { confirmarImportacao, descartarImportacao } from "../actions";

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
 * ninguem mais sabe distinguir. Aqui tudo ainda e editavel e nada foi gravado.
 */
export default async function Conferir({ params }: { params: Promise<{ id: string }> }) {
  await requireSession();

  const { id } = await params;
  const lote = await lerImportacao(fromPostgres(getSql()), id);
  if (!lote) notFound();

  const saidas = lote.linhas.reduce((total, l) => (l.valor < 0 ? total - l.valor : total), 0);
  const entradas = lote.linhas.reduce((total, l) => (l.valor > 0 ? total + l.valor : total), 0);
  const duvidosas = lote.linhas.filter((l) => l.confianca !== "alta").length;
  const indices = lote.linhas.map((_, i) => String(i)).join(",");

  return (
    <main className="page">
      <div className="masthead">
        <h1>Conferir leitura</h1>
        <span className="period">
          {lote.images} {lote.images === 1 ? "imagem" : "imagens"} ·{" "}
          {quando.format(lote.createdAt)}
        </span>
      </div>

      <Nav atual="/conexoes" />

      {lote.status !== "pendente" ? (
        <p className="banner">
          <strong>Lote ja {lote.status}.</strong> Nada aqui pode ser alterado — envie novos prints
          em <a href="/conexoes">Conexoes</a> se precisar corrigir algo.
        </p>
      ) : (
        <p className="banner">
          <strong>Nada foi gravado ainda.</strong> Estes valores foram lidos das imagens por um
          modelo, nao vieram do banco. Confira cada linha, corrija o que estiver errado e desmarque
          o que nao deve entrar. So depois de confirmar eles viram lancamentos.
        </p>
      )}

      {lote.note ? (
        <p className="banner">
          <strong>Observacao da leitura.</strong> {lote.note}
        </p>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Despesas lidas</div>
          <div className="tile-value negative">{formatBRL(-saidas)}</div>
          <div className="tile-note">
            {lote.linhas.length} {lote.linhas.length === 1 ? "linha" : "linhas"}
          </div>
        </div>
        <div className="card">
          <div className="tile-label">Entradas lidas</div>
          <div className="tile-value positive">{formatBRL(entradas)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Leitura duvidosa</div>
          <div className={`tile-value ${duvidosas > 0 ? "negative" : ""}`}>{duvidosas}</div>
          <div className="tile-note">Linhas que o modelo nao leu com confianca alta</div>
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

          <section>
            <h2>Linhas lidas</h2>
            <div className="card table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Incluir</th>
                    <th>Data</th>
                    <th>Descricao</th>
                    <th>Tipo</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {lote.linhas.map((linha, i) => (
                    <tr key={linha.id} className={linha.confianca !== "alta" ? "duvidosa" : ""}>
                      <td>
                        <input
                          type="checkbox"
                          name={`incluir_${i}`}
                          defaultChecked
                          aria-label={`Incluir ${linha.descricao}`}
                        />
                        <input
                          type="hidden"
                          name={`confianca_${i}`}
                          value={linha.confianca}
                        />
                      </td>
                      <td>
                        <input
                          type="date"
                          name={`data_${i}`}
                          defaultValue={linha.dia}
                          aria-label="Data"
                        />
                      </td>
                      <td className="description">
                        <input
                          type="text"
                          name={`descricao_${i}`}
                          defaultValue={linha.descricao}
                          className="largo"
                          aria-label="Descricao"
                        />
                        {linha.confianca !== "alta" ? (
                          <span className="tag">leitura {linha.confianca}</span>
                        ) : null}
                      </td>
                      <td>
                        <select name={`tipo_${i}`} defaultValue={linha.valor > 0 ? "entrada" : "despesa"}>
                          <option value="despesa">Despesa</option>
                          <option value="entrada">Entrada</option>
                        </select>
                      </td>
                      <td className="amount">
                        <input
                          type="text"
                          inputMode="decimal"
                          name={`valor_${i}`}
                          defaultValue={Math.abs(linha.valor).toFixed(2)}
                          className="numerico"
                          aria-label="Valor"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {lote.status === "pendente" ? (
            <div className="filtros" style={{ marginTop: 18 }}>
              <button type="submit">Confirmar e lancar</button>
            </div>
          ) : null}
        </form>
      )}

      {lote.status === "pendente" ? (
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
