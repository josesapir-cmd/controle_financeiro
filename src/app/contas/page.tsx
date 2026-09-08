import { requireSession } from "@/lib/auth/guard";
import { Nav } from "@/components/Nav";
import { SairButton } from "@/components/SairButton";
import { CartaoDaConta } from "./CartaoDaConta";
import { dataCompleta } from "@/lib/finance/dates";
import { loadCadastroDeContas, type CadastroDeContas } from "@/lib/finance/service";

export const dynamic = "force-dynamic";

/**
 * Cadastro das contas, e dos cartoes dentro delas.
 *
 * Existe por causa do cartao adicional: no Open Finance ele nao e conta
 * separada e o banco nao manda o nome de quem usou, entao o gasto de outra
 * pessoa entra misturado na fatura do titular. O unico separador que chega e o
 * numero do plastico, e e aqui que ele ganha um nome e um destino.
 *
 * Os cartoes nao sao cadastrados: sao descobertos lendo o historico. Um cartao
 * que nao aparece em nenhum lancamento nao pode receber regra — e nao deveria
 * mesmo, porque nao ha o que classificar.
 */
export default async function Contas() {
  await requireSession();

  let dados: CadastroDeContas;
  try {
    dados = await loadCadastroDeContas();
  } catch (erro) {
    return (
      <main className="page">
        <div className="masthead">
          <h1>Contas</h1>
        </div>
        <Nav atual="/contas" />
        <p className="banner">
          {erro instanceof Error ? erro.message : "Erro ao carregar as contas."}
        </p>
      </main>
    );
  }

  const comCartao = dados.contas.filter((conta) => conta.cartoes.length > 0);
  const semCartao = dados.contas.filter((conta) => conta.cartoes.length === 0);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Contas</h1>
        <span className="period">
          Cartoes vistos desde {dataCompleta(dados.desde)}
          <SairButton />
        </span>
      </div>

      <Nav atual="/contas" />

      <p className="empty" style={{ marginTop: 0 }}>
        Um cartao adicional nao e uma conta separada: as compras dele entram na fatura do titular,
        e o banco nao diz de quem sao. Dar uma categoria a um cartao aqui manda todas as despesas
        dele para essa categoria — e essa regra vence a que a contraparte herdaria.
      </p>

      {comCartao.map((conta) => (
        <section key={conta.id} className="gr ct-conta">
          <header>
            <h2 className="cp-nome">{conta.nome}</h2>
            <span className="account-meta">
              {conta.connectorName} · {conta.cartoes.length}{" "}
              {conta.cartoes.length === 1 ? "cartao" : "cartoes"} no historico
            </span>
          </header>

          {conta.cartoes.map((cartao) => (
            <CartaoDaConta
              key={cartao.numero}
              contaId={conta.id}
              cartao={cartao}
              categorias={dados.categorias}
              centros={dados.centros}
            />
          ))}
        </section>
      ))}

      {comCartao.length === 0 ? (
        <p className="empty">
          Nenhum cartao encontrado no historico. Os plasticos aparecem conforme os lancamentos de
          cartao sao sincronizados.
        </p>
      ) : null}

      {/* As outras contas entram como lista simples: elas nao tem plastico para
          separar, e escondê-las faria a tela parecer incompleta. */}
      {semCartao.length > 0 ? (
        <section className="gr">
          <h2 className="cp-nome">Demais contas</h2>
          <div className="gr-rolagem">
            <table className="gr-tabela">
              <thead>
                <tr>
                  <th scope="col">Conta</th>
                  <th scope="col">Instituicao</th>
                  <th scope="col">Tipo</th>
                </tr>
              </thead>
              <tbody>
                {semCartao.map((conta) => (
                  <tr key={conta.id}>
                    <th scope="row">{conta.nome}</th>
                    <td>{conta.connectorName}</td>
                    <td>{conta.subtipo ?? conta.tipo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </main>
  );
}
