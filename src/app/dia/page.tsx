import Link from "next/link";
import { AccountFilter } from "@/components/AccountFilter";
import { DayStrip } from "@/components/DayStrip";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { isUserInitiatedExpense } from "@/lib/finance/automatic";
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
  searchParams: Promise<{ d?: string; f?: string; contas?: string | string[] }>;
}) {
  const params = await searchParams;
  const dia = params.d && DATA_ISO.test(params.d) ? params.d : localDay(new Date());
  const verTudo = params.f === "tudo";
  const accountIds = parseAccountIds(params.contas);
  const contasQuery = accountQuery(accountIds);

  const dados = await loadDay(dia, { accountIds });

  // Por padrao a aba responde "o que eu fiz neste dia": so despesas iniciadas
  // por voce, sem IOF, rendimento de saldo remunerado nem movimentacoes.
  const lancamentos = verTudo
    ? dados.transactions
    : dados.transactions.filter(isUserInitiatedExpense);

  const escondidos = dados.transactions.length - lancamentos.length;

  let blocoAtual = "";

  return (
    <main className="page">
      <div className="masthead">
        <h1>Linha do tempo</h1>
        <span className="period">
          <Link href={`/?${contasQuery}`}>Painel</Link> ·{" "}
          <Link href={`/contrapartes?${contasQuery}`}>Contrapartes</Link> ·{" "}
          <Link href="/conexoes">Conexoes</Link>
        </span>
      </div>

      <div className="period-controls">
        <div className="presets">
          <Link className="preset" href={`/dia?${buildQuery(`d=${shiftDay(dia, -1)}`, contasQuery)}`}>
            ← Dia anterior
          </Link>
          <Link className="preset" href={`/dia?${buildQuery(`d=${localDay(new Date())}`, contasQuery)}`}>
            Hoje
          </Link>
          <Link className="preset" href={`/dia?${buildQuery(`d=${shiftDay(dia, 1)}`, contasQuery)}`}>
            Proximo dia →
          </Link>
        </div>

        <AccountFilter
          options={dados.accountOptions}
          selected={accountIds}
          action="/dia"
          hidden={{ d: dia, f: verTudo ? "tudo" : undefined }}
        />

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

      <div className="filtros">
        <Link
          className={verTudo ? "preset" : "preset ativo"}
          href={`/dia?${buildQuery(`d=${dia}`, contasQuery)}`}
        >
          Despesas que eu iniciei
        </Link>
        <Link
          className={verTudo ? "preset ativo" : "preset"}
          href={`/dia?${buildQuery(`d=${dia}`, "f=tudo", contasQuery)}`}
        >
          Todos os lancamentos
        </Link>
      </div>

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
          <div className="tile-value">{lancamentos.length}</div>
          {dados.transfers > 0 ? (
            <div className="tile-note">
              inclui {formatBRL(dados.transfers)} em movimentacoes
            </div>
          ) : null}
        </div>
      </div>

      <DayStrip transactions={lancamentos} />

      <section>
        {!verTudo && escondidos > 0 ? (
          <p className="period" style={{ display: "block", marginBottom: 12 }}>
            {escondidos} {escondidos === 1 ? "lancamento oculto" : "lancamentos ocultos"}: entradas,
            IOF, rendimento de saldo remunerado e movimentacoes.
          </p>
        ) : null}

        {lancamentos.length === 0 ? (
          <div className="card">
            <p className="empty">
              {dados.transactions.length === 0
                ? "Nenhum lancamento neste dia. Use as setas acima para navegar."
                : "Nenhuma despesa iniciada por voce neste dia. Veja todos os lancamentos acima."}
            </p>
          </div>
        ) : (
          <ol className="timeline">
            {lancamentos.map((t) => {
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
