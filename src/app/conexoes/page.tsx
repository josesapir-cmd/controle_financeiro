import Link from "next/link";
import { requireSession } from "@/lib/auth/guard";
import { loadConnections, type ConnectionRow } from "@/lib/finance/service";
import { AddDeviceButton } from "@/components/AddDeviceButton";
import { ConnectionForm } from "./ConnectionForm";
import { SyncButton } from "./SyncButton";
import { removerConexao } from "./actions";

export const dynamic = "force-dynamic";

const quando = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function Conexoes() {
  await requireSession();

  let linhas: ConnectionRow[] = [];
  let erroGeral: string | undefined;

  try {
    linhas = await loadConnections();
  } catch (error) {
    erroGeral = error instanceof Error ? error.message : "Erro ao carregar conexoes.";
  }

  return (
    <main className="page">
      <div className="masthead">
        <h1>Conexoes</h1>
        <span className="period">
          <Link href="/">Painel</Link> · <Link href="/dia">Dia</Link> ·{" "}
          <Link href="/contrapartes">Contrapartes</Link>
        </span>
      </div>

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
