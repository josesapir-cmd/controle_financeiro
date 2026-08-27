import Link from "next/link";
import { loadConnections, type ConnectionRow } from "@/lib/finance/service";
import { ConnectionForm } from "./ConnectionForm";
import { removerConexao } from "./actions";

export const dynamic = "force-dynamic";

export default async function Conexoes() {
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
        <Link href="/" className="period">
          ← Voltar ao painel
        </Link>
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
          Precisa ser manual porque a API da Pluggy nao permite listar conexoes com credenciais
          pessoais: as rotas de listagem respondem 403.
        </p>
        <ConnectionForm />
      </section>

      <section>
        <h2>Conexoes cadastradas ({linhas.length})</h2>

        {erroGeral ? <p className="banner">{erroGeral}</p> : null}

        {linhas.length === 0 && !erroGeral ? (
          <div className="card">
            <p className="empty">Nenhuma conexao ainda. Adicione a primeira acima.</p>
          </div>
        ) : null}

        <div className="accounts">
          {linhas.map(({ stored, item, contas, erro }) => {
            const nome = item?.connector.name ?? (erro ? "Conexao indisponivel" : "Conexao ativa");
            const detalhe = item
              ? `Status ${item.status}`
              : erro
                ? erro
                : `${contas} ${contas === 1 ? "conta encontrada" : "contas encontradas"}`;

            return (
            <div className="card" key={stored.id}>
              <div className="account-name">{nome}</div>
              <div className="account-meta">{detalhe}</div>
              <div className="account-meta" style={{ marginTop: 8, wordBreak: "break-all" }}>
                <code>{stored.id}</code>
              </div>

              {stored.source === "env" ? (
                <div className="tile-note">
                  Definida em <code>PLUGGY_ITEM_IDS</code>. Para remover, edite o{" "}
                  <code>.env.local</code>.
                </div>
              ) : (
                <form action={removerConexao} style={{ marginTop: 12 }}>
                  <input type="hidden" name="itemId" value={stored.id} />
                  <button type="submit" className="danger">
                    Remover
                  </button>
                </form>
              )}
            </div>
            );
          })}
        </div>
      </section>
    </main>
  );
}
