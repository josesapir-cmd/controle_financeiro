import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import {
  loadConnections,
  loadImportacoes,
  type ConnectionRow,
  type ImportacaoResumo,
} from "@/lib/finance/service";
import { AddDeviceButton } from "@/components/AddDeviceButton";
import { Nav } from "@/components/Nav";
import { formatBRL } from "@/lib/finance/money";
import { ConnectionForm } from "./ConnectionForm";
import { SyncButton } from "./SyncButton";
import { UploadPrints } from "./UploadPrints";
import { removerConexao } from "./actions";

export const dynamic = "force-dynamic";

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function Conexoes({
  searchParams,
}: {
  searchParams: Promise<{ importado?: string }>;
}) {
  await requireSession();

  const importado = Number((await searchParams).importado ?? "");
  let linhas: ConnectionRow[] = [];
  let lotes: ImportacaoResumo[] = [];
  let erroGeral: string | undefined;

  try {
    linhas = await loadConnections();
  } catch (error) {
    erroGeral = error instanceof Error ? error.message : "Erro ao carregar conexoes.";
  }

  // Em chamada separada de proposito: um problema nos lotes de importacao — a
  // migracao ainda nao aplicada, por exemplo — nao pode esconder as conexoes.
  try {
    lotes = await loadImportacoes();
  } catch {
    lotes = [];
  }

  const pendentes = lotes.filter((lote) => lote.status === "pendente");

  return (
    <main className="page">
      <div className="masthead">
        <h1>Conexoes</h1>
      </div>

      <Nav atual="/conexoes" />

      {Number.isFinite(importado) && importado > 0 ? (
        <p className="banner">
          <strong>
            {importado} {importado === 1 ? "lancamento gravado" : "lancamentos gravados"}
          </strong>{" "}
          no saldo compartilhado. Eles ja aparecem no <Link href="/">painel</Link> e em{" "}
          <Link href="/contrapartes">contrapartes</Link>.
        </p>
      ) : null}

      {pendentes.length > 0 ? (
        <p className="banner">
          <strong>
            {pendentes.length}{" "}
            {pendentes.length === 1 ? "leitura aguarda" : "leituras aguardam"} conferencia.
          </strong>{" "}
          Enquanto nao forem confirmadas, esses gastos continuam fora do controle:{" "}
          <Link href={`/importar/${pendentes[0].id}`}>conferir agora</Link>.
        </p>
      ) : null}

      <section className="card">
        <h2>Saldo compartilhado do Nubank</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          Esses gastos nao chegam pelo Open Finance: a conta corrente mostra so a transferencia
          mensal, e o que foi comprado acontece do outro lado. Selecione quantos prints da tela de
          extrato do saldo compartilhado quiser — eles sao lidos em fila, alguns por vez, e as
          despesas aparecem para conferencia antes de virar lancamento.
          <br />
          <br />
          Linha que se repete entre prints diferentes (mesma data, valor e contraparte) vem marcada
          como possivel repeticao e desmarcada, para voce decidir: pode ser a mesma compra
          fotografada duas vezes, ou duas compras iguais de verdade.
          <br />
          <br />
          E uma ponte, nao a fonte definitiva: quando o arquivo categorizado do Poupa.ai for
          carregado, ele substitui esta leitura com a classificacao ja feita.
        </p>
        <UploadPrints />

        {lotes.length > 0 ? (
          <ul className="resultado-sync" style={{ marginTop: 16 }}>
            {lotes.map((lote) => (
              <li key={lote.id}>
                <span className="description">
                  <Link href={`/importar/${lote.id}`}>
                    {quando.format(lote.createdAt)} · {lote.images}{" "}
                    {lote.images === 1 ? "imagem" : "imagens"}
                  </Link>
                </span>
                <span className="account-meta">
                  {lote.linhas} {lote.linhas === 1 ? "linha" : "linhas"} ·{" "}
                  {formatBRL(-lote.saidas)} · {lote.status}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section className="card">
        <h2>Adicionar conexao</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          Abra a conexao no <a href="https://meu.pluggy.ai">Meu Pluggy</a> e cole aqui a URL da
          barra de enderecos — algo como{" "}
          <code>meu.pluggy.ai/connections/fe3eb491-…</code>. O <code>itemId</code> e extraido
          automaticamente.
          <br />
          <br />
          E manual por limitacao da API: com credenciais pessoais, as rotas de listagem respondem
          403. A conexao aparece abaixo assim que a proxima sincronizacao rodar.
        </p>
        <ConnectionForm />
      </section>

      <section className="card">
        <h2>Dispositivos</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          Passkey vale por dispositivo. Para entrar pelo celular, gere um codigo aqui — assim voce
          nao gasta o codigo de recuperacao, que deve ficar guardado para o caso de perder tudo.
        </p>
        <AddDeviceButton />
      </section>

      <section className="card">
        <h2>Sincronizacao</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          Cadastrar uma conexao apenas a registra. Os dados aparecem quando a sincronizacao roda —
          manualmente aqui, ou automaticamente a cada 6 horas depois do deploy.
        </p>
        <SyncButton />
      </section>

      <section>
        <h2>Conexoes ({linhas.length})</h2>

        {erroGeral ? <p className="banner">{erroGeral}</p> : null}

        {linhas.length === 0 && !erroGeral ? (
          <div className="card">
            <p className="empty">Nenhuma conexao ainda. Adicione a primeira acima.</p>
          </div>
        ) : null}

        <div className="accounts">
          {linhas.map((linha) => (
            <div className="card" key={linha.itemId}>
              <div className="account-name">{linha.connectorName}</div>

              <div className="account-meta">
                {linha.accounts} {linha.accounts === 1 ? "conta" : "contas"}
                {linha.lastSyncedAt
                  ? ` · sincronizado em ${quando.format(linha.lastSyncedAt)}`
                  : " · aguardando a primeira sincronizacao"}
              </div>

              {/* Erro de sincronizacao precisa aparecer: sem isso, dado velho
                  passa por dado atual sem ninguem notar. */}
              {linha.lastSyncError ? (
                <div className="tile-note negative">{linha.lastSyncError}</div>
              ) : null}

              <div className="account-meta" style={{ marginTop: 8, wordBreak: "break-all" }}>
                <code>{linha.itemId}</code>
              </div>

              <form action={removerConexao} style={{ marginTop: 12 }}>
                <input type="hidden" name="itemId" value={linha.itemId} />
                <button type="submit" className="danger">
                  Remover
                </button>
              </form>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
