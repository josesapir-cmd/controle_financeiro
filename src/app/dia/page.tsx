import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { DayStrip } from "@/components/DayStrip";
import { FiltroDeContas } from "@/components/FiltroDeContas";
import { accountQuery, buildQuery, parseAccountIds } from "@/lib/finance/account-selection";
import { coresPorConta } from "@/lib/finance/cores-de-conta";
import { localDay } from "@/lib/finance/dates";
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

      <section>
        <h2>{soNaoClassificados ? "Classificar" : "Lancamentos do dia"}</h2>
        <Classificador
          lancamentos={paraOClassificador}
          categorias={paraClassificar.categorias}
        />
      </section>
    </main>
  );
}
