import Link from "next/link";
import { translateCategory } from "@/lib/finance/categories";
import { maskDocument } from "@/lib/finance/counterparties";
import { localDay, localTime, shiftDay } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { loadDay } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const diaExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

/**
 * Faixa do dia a que um horario pertence. Serve para agrupar a linha do tempo em
 * blocos reconheciveis — lembrar "foi de manha" e mais facil que lembrar a hora.
 */
function periodoDoDia(hora: string): string {
  const h = Number(hora.slice(0, 2));
  if (h < 6) return "Madrugada";
  if (h < 12) return "Manha";
  if (h < 18) return "Tarde";
  return "Noite";
}

export default async function Dia({
  searchParams,
}: {
  searchParams: Promise<{ d?: string }>;
}) {
  const params = await searchParams;
  const dia = params.d && DATA_ISO.test(params.d) ? params.d : localDay(new Date());

  const dados = await loadDay(dia);

  let blocoAtual = "";

  return (
    <main className="page">
      <div className="masthead">
        <h1>Linha do tempo</h1>
        <span className="period">
          <Link href="/">Painel</Link> · <Link href="/contrapartes">Contrapartes</Link> ·{" "}
          <Link href="/conexoes">Conexoes</Link>
        </span>
      </div>

      <div className="period-controls">
        <div className="presets">
          <Link className="preset" href={`/dia?d=${shiftDay(dia, -1)}`}>
            ← Dia anterior
          </Link>
          <Link className="preset" href={`/dia?d=${localDay(new Date())}`}>
            Hoje
          </Link>
          <Link className="preset" href={`/dia?d=${shiftDay(dia, 1)}`}>
            Proximo dia →
          </Link>
        </div>

        <form className="range-form" method="get">
          <label>
            Dia <input type="date" name="d" defaultValue={dia} />
          </label>
          <button type="submit">Ver</button>
        </form>
      </div>

      <p className="period" style={{ display: "block", marginTop: 16 }}>
        {diaExtenso.format(new Date(`${dia}T12:00:00Z`))}
      </p>

      {dados.isMock ? (
        <p className="banner">
          <strong>Dados ficticios.</strong> <code>PLUGGY_MOCK</code> esta ativo.
        </p>
      ) : null}

      {dados.failures.length > 0 ? (
        <p className="banner">
          <strong>Dados incompletos.</strong> {dados.failures[0].message}
        </p>
      ) : null}

      <div className="tiles">
        <div className="card">
          <div className="tile-label">Gasto no dia</div>
          <div className="tile-value negative">{formatBRL(dados.spent)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Recebido no dia</div>
          <div className="tile-value positive">{formatBRL(dados.received)}</div>
        </div>
        <div className="card">
          <div className="tile-label">Lancamentos</div>
          <div className="tile-value">{dados.transactions.length}</div>
          {dados.transfers > 0 ? (
            <div className="tile-note">
              inclui {formatBRL(dados.transfers)} em movimentacoes
            </div>
          ) : null}
        </div>
      </div>

      <section>
        {dados.transactions.length === 0 ? (
          <div className="card">
            <p className="empty">
              Nenhum lancamento neste dia. Use as setas acima para navegar.
            </p>
          </div>
        ) : (
          <ol className="timeline">
            {dados.transactions.map((t) => {
              const hora = localTime(t.date);
              const bloco = periodoDoDia(hora);
              const abreBloco = bloco !== blocoAtual;
              if (abreBloco) blocoAtual = bloco;

              const saida = t.amount < 0;

              return (
                <li key={t.id}>
                  {abreBloco ? <div className="timeline-bloco">{bloco}</div> : null}

                  <div className="timeline-item">
                    <time className="timeline-hora" dateTime={t.date}>
                      {hora}
                    </time>
                    <span className={`timeline-marca ${saida ? "saida" : "entrada"}`} aria-hidden />
                    <div className="timeline-corpo">
                      <div className="timeline-linha">
                        <span className="description">{t.description}</span>
                        <span className={`bar-value ${saida ? "negative" : "positive"}`}>
                          {formatBRL(t.amount)}
                        </span>
                      </div>
                      <div className="account-meta">
                        {[
                          t.category ? translateCategory(t.category) : null,
                          t.counterparty?.name,
                          t.counterparty?.document
                            ? maskDocument(t.counterparty.document, t.counterparty.documentType)
                            : null,
                          dados.accountNames[t.accountId],
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </main>
  );
}
