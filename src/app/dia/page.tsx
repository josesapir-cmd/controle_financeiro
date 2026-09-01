import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { DayStrip } from "@/components/DayStrip";
import { FiltroDeContas } from "@/components/FiltroDeContas";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { translateCategory } from "@/lib/finance/categories";
import { coresPorConta } from "@/lib/finance/cores-de-conta";
import { maskDocument } from "@/lib/finance/counterparties";
import { localDay, localTime } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import { rotuloContemNome, rotuloDoLancamento } from "@/lib/finance/rotulo";
import { loadClassificacaoDoDia, loadDay } from "@/lib/finance/service";
import { Classificador } from "./Classificador";
import { SpinnerDeDatas } from "./SpinnerDeDatas";

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
  searchParams: Promise<{ d?: string; nc?: string; contas?: string | string[] }>;
}) {
  await requireSession();

  const params = await searchParams;
  const dia = params.d && DATA_ISO.test(params.d) ? params.d : localDay(new Date());
  // Um filtro so: "so os nao classificados". O dia inteiro e o padrao — esconder
  // lancamento por regra de negocio ja custou confianca aqui antes.
  const soNaoClassificados = params.nc === "1";
  const accountIds = parseAccountIds(params.contas);
  const contasQuery = accountQuery(accountIds);

  const [dados, paraClassificar] = await Promise.all([
    loadDay(dia, { accountIds }),
    loadClassificacaoDoDia(dia, { accountIds }),
  ]);

  // Nao classificado e o que o app nao sabe categorizar, nem por rotulo proprio
  // nem herdado da contraparte. Entrada e movimentacao nao entram na conta: nao
  // pedem categoria, entao nunca ficariam "pendentes".
  const pendentes = new Set(
    paraClassificar.lancamentos.filter((l) => !l.categoriaId).map((l) => l.id),
  );

  const lancamentos = soNaoClassificados
    ? dados.transactions.filter((t) => pendentes.has(t.id))
    : dados.transactions;

  const paraOClassificador = soNaoClassificados
    ? paraClassificar.lancamentos.filter((l) => pendentes.has(l.id))
    : paraClassificar.lancamentos;

  const cores = coresPorConta(dados.accountOptions);

  // Rotulos ja calculados para os cartoes de classificar, reaproveitados na
  // lista: sao os unicos que conhecem o apelido da contraparte. O que sobra —
  // entradas e movimentacoes, que nao passam pelo classificador — cai no mesmo
  // calculo com o nome do extrato.
  const rotulos = new Map(paraClassificar.lancamentos.map((l) => [l.id, l.descricao]));
  const rotuloDe = (t: (typeof dados.transactions)[number]) =>
    rotulos.get(t.id) ?? rotuloDoLancamento(t, t.counterparty?.name);

  let blocoAtual = "";

  return (
    <main className="page">
      <div className="masthead">
        <h1>Linha do tempo</h1>
      </div>

      <Nav atual="/dia" contasQuery={contasQuery} />

      <div className="period-controls">
        <SpinnerDeDatas
          dia={dia}
          queryExtra={buildQuery(soNaoClassificados ? "nc=1" : undefined, contasQuery)}
        />

        <FiltroDeContas
          options={dados.accountOptions}
          selected={accountIds}
          action="/dia"
          extra={{ d: dia, nc: soNaoClassificados ? "1" : undefined }}
        />

        <div className="filtros">
          <Link
            className={soNaoClassificados ? "preset ativo" : "preset"}
            href={
              soNaoClassificados
                ? `/dia?${buildQuery(`d=${dia}`, contasQuery)}`
                : `/dia?${buildQuery(`d=${dia}`, "nc=1", contasQuery)}`
            }
            aria-current={soNaoClassificados ? "true" : undefined}
          >
            So nao classificados
            {pendentes.size > 0 ? <span className="preset-conta">{pendentes.size}</span> : null}
          </Link>
        </div>
      </div>

      <p className="period" style={{ display: "block", marginTop: 16 }}>
        {diaExtenso.format(new Date(`${dia}T12:00:00Z`))}
      </p>

      <DayStrip transactions={lancamentos} cores={cores} nomes={dados.accountNames} />

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

      {paraOClassificador.length > 0 && paraClassificar.categorias.length > 0 ? (
        <section>
          <h2>Classificar</h2>
          <Classificador
            lancamentos={paraOClassificador}
            categorias={paraClassificar.categorias}
          />
        </section>
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

      <section>
        {lancamentos.length === 0 ? (
          <div className="card">
            <p className="empty">
              {soNaoClassificados
                ? "Nada pendente de classificacao neste dia."
                : "Nenhum lancamento neste dia. Use a fita de datas acima para navegar."}
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
              const rotulo = rotuloDe(t);

              return (
                <li key={t.id}>
                  {abreBloco ? <div className="timeline-bloco">{bloco}</div> : null}

                  <div className="timeline-item">
                    <time className="timeline-hora" dateTime={t.date}>
                      {hora}
                    </time>
                    <span
                      className={`timeline-marca ${saida ? "saida" : "entrada"}`}
                      style={
                        cores[t.accountId]
                          ? ({ "--conta-cor": cores[t.accountId] } as React.CSSProperties)
                          : undefined
                      }
                      aria-hidden
                    />
                    <div className="timeline-corpo">
                      <div className="timeline-linha">
                        <span className="description">{rotulo}</span>
                        <span className={`bar-value ${saida ? "negative" : "positive"}`}>
                          {formatBRL(t.amount)}
                        </span>
                      </div>
                      <div className="account-meta">
                        {[
                          t.category ? translateCategory(t.category) : null,
                          // O nome so repete aqui se o titulo nao o trouxe.
                          rotuloContemNome(rotulo, t.counterparty?.name)
                            ? null
                            : t.counterparty?.name,
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
