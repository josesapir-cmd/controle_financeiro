import { dataCompleta } from "@/lib/finance/dates";
import { formatBRL } from "@/lib/finance/money";
import type { Carteira } from "@/lib/finance/service";
import { TabelaDePapeis } from "./TabelaDePapeis";

/**
 * A carteira que veio do Open Finance.
 *
 * Um cartao de resumo e uma tabela so. As tabelas "por classe" e "por
 * instituicao" que ficavam aqui viraram os dois primeiros niveis da tabela de
 * papeis — eram resumos do que ela ja mostra, e tres tabelas do mesmo dinheiro
 * na mesma tela fazem o olho conferir em vez de ler.
 *
 * Fotografia do que existe hoje, e nao extrato: nao tem periodo, e o numero que
 * importa e o saldo de mercado. O lucro aparece ao lado quando a instituicao
 * informa — e so quando informa, porque zero diria que nao rendeu nada, que e
 * outra afirmacao.
 *
 * Uma matiz so nas barras: o nome da classe ja esta escrito na linha, e dar uma
 * cor a cada uma acrescentaria arco-iris, nao informacao.
 */
export function CarteiraDeInvestimentos({ carteira }: { carteira: Carteira }) {
  if (carteira.papeis.length === 0) {
    return (
      <section className="gr">
        <figcaption className="gr-titulo">Carteira</figcaption>
        <p className="empty" style={{ margin: 0 }}>
          Nenhuma posicao sincronizada. Elas chegam junto com o extrato, das
          conexoes que expoem investimento — rode uma sincronizacao em{" "}
          <strong>Conexoes</strong>.
        </p>
      </section>
    );
  }

  const rendimento =
    carteira.lucro !== null && carteira.total - carteira.lucro > 0
      ? carteira.lucro / (carteira.total - carteira.lucro)
      : null;

  return (
    <>
      <section className="card cp-resumo">
        <div className="cp-resumo-topo">
          <div className="tile-label">Carteira</div>
          {carteira.vistoEm ? (
            <span className="account-meta">
              posicao de{" "}
              {dataCompleta(carteira.vistoEm.toISOString().slice(0, 10))}
            </span>
          ) : null}
        </div>

        <div className="tile-value">{formatBRL(carteira.total)}</div>

        <div className="tile-note">
          {carteira.papeis.length}{" "}
          {carteira.papeis.length === 1 ? "papel" : "papeis"} em{" "}
          {carteira.porInstituicao.length}{" "}
          {carteira.porInstituicao.length === 1
            ? "instituicao"
            : "instituicoes"}
          {carteira.lucro !== null ? (
            <>
              {" · "}
              <span className="positive">{formatBRL(carteira.lucro)}</span> de
              lucro
              {rendimento !== null
                ? ` (${(rendimento * 100).toFixed(1)}%)`
                : ""}
            </>
          ) : null}
        </div>
      </section>

      <TabelaDePapeis posicoes={carteira.posicoes} />
    </>
  );
}
