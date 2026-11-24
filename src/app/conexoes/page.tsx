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
import { ConnectionForm } from "./ConnectionForm";
import { SyncButton } from "./SyncButton";
import { UploadPrints } from "./UploadPrints";
import { removerConexao, revogarAcessoDaAssistente } from "./actions";
import { ConviteAssistente } from "./ConviteAssistente";
import { listCredentials, pendingAssistantInvite } from "@/lib/auth/credentials";

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

  // Separado pelo mesmo motivo: antes da migracao 027 nao ha assistente, e a
  // secao dela nao pode derrubar a pagina.
  let assistente: { passkeys: Awaited<ReturnType<typeof listCredentials>>; convite: Date | null } =
    { passkeys: [], convite: null };
  try {
    const [credenciais, convite] = await Promise.all([listCredentials(), pendingAssistantInvite()]);
    assistente = { passkeys: credenciais.filter((c) => c.papel === "assistente"), convite };
  } catch {
    // Sem a secao, e nao sem a pagina.
  }

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
          <Link href="/importar">conferir agora</Link>.
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
          <p className="account-meta" style={{ marginTop: 16 }}>
            <Link href="/importar">Ver todas as importacoes por imagem</Link> — {lotes.length}{" "}
            {lotes.length === 1 ? "leitura" : "leituras"} ate agora
            {pendentes.length > 0 ? `, ${pendentes.length} aguardando conferencia` : ""}.
          </p>
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
        <h2>Assistente</h2>
        <p className="empty" style={{ marginTop: 0 }}>
          A assistente entra com passkey propria e ve uma tela so: envia prints do saldo
          compartilhado, confere o que foi lido e classifica esses gastos — categoria,
          subcategoria, nome da contraparte, comentario e comprovantes. Nao ve saldos, contas,
          cartoes nem nenhuma outra tela.{" "}
          <Link href="/assistente">Abrir a tela dela</Link>.
        </p>

        {assistente.passkeys.length > 0 ? (
          <ul style={{ margin: "0 0 14px", paddingLeft: 18 }}>
            {assistente.passkeys.map((p) => (
              <li key={p.id} className="account-meta">
                Passkey criada em {p.createdAt.toLocaleDateString("pt-BR")}
                {p.lastUsedAt
                  ? ` · ultimo acesso em ${p.lastUsedAt.toLocaleDateString("pt-BR")}`
                  : " · ainda nao usada"}
                {p.label ? ` · ${p.label}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        {assistente.convite ? (
          <p className="account-meta">
            Ha um convite valido ate {assistente.convite.toLocaleString("pt-BR")}.
          </p>
        ) : null}

        <div className="filtros">
          <ConviteAssistente temConvite={Boolean(assistente.convite)} />
          {assistente.passkeys.length > 0 || assistente.convite ? (
            <form action={revogarAcessoDaAssistente}>
              <button type="submit" className="danger">
                Revogar acesso da assistente
              </button>
            </form>
          ) : null}
        </div>
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
