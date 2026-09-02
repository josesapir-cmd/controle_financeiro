import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { DayStrip } from "@/components/DayStrip";
import { FiltroDeContas } from "@/components/FiltroDeContas";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { coresPorConta } from "@/lib/finance/cores-de-conta";
import { localDay, shiftDay } from "@/lib/finance/dates";
import { loadClassificacaoDoDia, loadDay, loadSituacaoDaFita } from "@/lib/finance/service";
import { Classificador } from "./Classificador";
import { SpinnerDeDatas } from "./SpinnerDeDatas";

export const dynamic = "force-dynamic";

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

const diaExtenso = new Intl.DateTimeFormat("pt-BR", {
  weekday: "long",
  day: "2-digit",
  month: "long",
});

export default async function Dia({
  searchParams,
}: {
  searchParams: Promise<{ d?: string; nc?: string; jogo?: string; contas?: string | string[] }>;
}) {
  await requireSession();

  const params = await searchParams;
  const dia = params.d && DATA_ISO.test(params.d) ? params.d : localDay(new Date());
  // Um filtro so: "so os nao classificados". O dia inteiro e o padrao — esconder
  // lancamento por regra de negocio ja custou confianca aqui antes.
  const soNaoClassificados = params.nc === "1";
  const accountIds = parseAccountIds(params.contas);
  const contasQuery = accountQuery(accountIds);

  // A fita mostra 20 dias atras e 2 a frente; a situacao de cada um vem junto
  // para as bolinhas nao precisarem de uma consulta por dia.
  const hoje = localDay(new Date());

  const [dados, paraClassificar, situacao] = await Promise.all([
    loadDay(dia, { accountIds }),
    loadClassificacaoDoDia(dia, { accountIds }),
    loadSituacaoDaFita(shiftDay(hoje, -20), shiftDay(hoje, 2), { accountIds, hoje }),
  ]);

  // Nao classificado e o que o app nao sabe categorizar, nem por rotulo proprio
  // nem herdado da contraparte. Entrada e movimentacao nao entram na conta: nao
  // pedem categoria, entao nunca ficariam "pendentes".
  const pendentes = new Set(
    paraClassificar.lancamentos
      .filter((l) => l.classificavel && !l.categoriaId)
      .map((l) => l.id),
  );

  const lancamentos = soNaoClassificados
    ? dados.transactions.filter((t) => pendentes.has(t.id))
    : dados.transactions;

  const paraOClassificador = soNaoClassificados
    ? paraClassificar.lancamentos.filter((l) => pendentes.has(l.id))
    : paraClassificar.lancamentos;

  const cores = coresPorConta(dados.accountOptions);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Linha do tempo</h1>
      </div>

      <Nav atual="/dia" contasQuery={contasQuery} />

      {/* A fita fica fora dos outros controles porque no celular ela gruda no
          alto da tela, e um `sticky` so anda dentro do proprio pai: dentro da
          barra de controles ela teria uns cem pixels de curso e nada mais. */}
      <div className="spinner-barra">
        <SpinnerDeDatas
          dia={dia}
          queryExtra={buildQuery(soNaoClassificados ? "nc=1" : undefined, contasQuery)}
          situacoes={situacao.dias}
        />
      </div>

      <div className="period-controls">
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

      <section>
        <h2>{soNaoClassificados ? "Classificar" : "Lancamentos do dia"}</h2>
        {/* A chave e o dia: trocar de data no modo jogo remonta o
            classificador, e o que ja foi despachado no dia anterior nao
            atravessa para o novo. */}
        <Classificador
          key={dia}
          dia={dia}
          lancamentos={paraOClassificador}
          categorias={paraClassificar.categorias}
          situacoes={situacao.dias}
          jogoAberto={params.jogo === "1"}
          queryExtra={buildQuery(soNaoClassificados ? "nc=1" : undefined, contasQuery)}
        />
      </section>
    </main>
  );
}
