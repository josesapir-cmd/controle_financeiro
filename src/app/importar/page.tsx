import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { formatBRL } from "@/lib/finance/money";
import { loadImportacoes, type ImportacaoResumo } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

/**
 * Historico das leituras de print do saldo compartilhado.
 *
 * Existe para separar o envio da aprovacao. Fotografar a tela e coisa de
 * celular, na hora; conferir valor por valor e coisa de tela grande, com calma.
 * Sem uma lista, o lote enviado pelo celular so seria alcancavel pelo link que
 * apareceu naquele momento — e leitura esquecida e dinheiro que continua fora
 * do controle.
 */

const ROTULOS: Record<string, string> = {
  pendente: "Aguardando conferencia",
  confirmado: "Lancado",
  descartado: "Descartado",
};

function Linha({ lote }: { lote: ImportacaoResumo }) {
  const pendente = lote.status === "pendente";
  const exigem = lote.decidir + lote.conferir;

  return (
    <div className="card">
      <div className="masthead" style={{ marginBottom: 6 }}>
        <div className="account-name">
          <Link href={`/importar/${lote.id}`}>{quando.format(lote.createdAt)}</Link>
        </div>
        <span className={`tag ${pendente ? "aviso" : ""}`}>
          {ROTULOS[lote.status] ?? lote.status}
        </span>
      </div>

      <div className="account-meta">
        {lote.images} {lote.images === 1 ? "imagem" : "imagens"} em {lote.envios}{" "}
        {lote.envios === 1 ? "envio" : "envios"} · {lote.linhas}{" "}
        {lote.linhas === 1 ? "linha" : "linhas"}
      </div>

      <div className="account-balance negative">{formatBRL(-lote.saidas)}</div>

      {pendente ? (
        <div className="tile-note">
          {exigem > 0 ? (
            <>
              {lote.decidir > 0 ? `${lote.decidir} a decidir` : null}
              {lote.decidir > 0 && lote.conferir > 0 ? " · " : null}
              {lote.conferir > 0 ? `${lote.conferir} a conferir` : null}
            </>
          ) : (
            "Nada exige atencao — so confirmar"
          )}
        </div>
      ) : null}

      {pendente ? (
        <div style={{ marginTop: 12 }}>
          <Link className="preset ativo" href={`/importar/${lote.id}`}>
            Conferir
          </Link>
        </div>
      ) : null}
    </div>
  );
}

export default async function Importacoes() {
  await requireSession();

  let lotes: ImportacaoResumo[] = [];
  let erro: string | undefined;

  try {
    lotes = await loadImportacoes(50);
  } catch (e) {
    erro = e instanceof Error ? e.message : "Erro ao carregar as importacoes.";
  }

  const pendentes = lotes.filter((l) => l.status === "pendente");
  const encerrados = lotes.filter((l) => l.status !== "pendente");
  const lancado = encerrados
    .filter((l) => l.status === "confirmado")
    .reduce((total, l) => total + l.saidas, 0);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Importacoes por imagem</h1>
        <span className="period">
          Saldo compartilhado do Nubank · <Link href="/conexoes">enviar prints</Link>
        </span>
      </div>

      <Nav atual="/conexoes" />

      {erro ? <p className="banner">{erro}</p> : null}

      {!erro && lotes.length === 0 ? (
        <section className="card">
          <p className="empty">
            Nenhuma leitura ainda. Envie prints da tela de saldo compartilhado em{" "}
            <Link href="/conexoes">Conexoes</Link> — da para fotografar pelo celular e conferir
            aqui pelo computador depois.
          </p>
        </section>
      ) : null}

      {pendentes.length > 0 ? (
        <section>
          <h2>
            Aguardando conferencia ({pendentes.length})
          </h2>
          <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
            Enquanto nao forem confirmadas, essas despesas continuam fora do painel.
          </p>
          <div className="accounts">
            {pendentes.map((lote) => (
              <Linha key={lote.id} lote={lote} />
            ))}
          </div>
        </section>
      ) : null}

      {encerrados.length > 0 ? (
        <section>
          <h2>Encerradas ({encerrados.length})</h2>
          {lancado > 0 ? (
            <p className="empty" style={{ marginTop: -6, marginBottom: 14 }}>
              {formatBRL(-lancado)} ja lancados no saldo compartilhado por esta via.
            </p>
          ) : null}
          <div className="accounts">
            {encerrados.map((lote) => (
              <Linha key={lote.id} lote={lote} />
            ))}
          </div>
        </section>
      ) : null}
    </main>
  );
}
