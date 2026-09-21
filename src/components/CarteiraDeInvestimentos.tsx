import type { Carteira } from "@/lib/finance/service";
import { TabelaDePapeis } from "./TabelaDePapeis";

/**
 * A carteira que veio do Open Finance: uma tabela, e o aviso de quando nao ha
 * nenhuma.
 *
 * Fotografia do que existe hoje, e nao extrato: nao tem periodo. Os resumos que
 * moravam aqui — o cartao com o total grande, "por classe" e "por instituicao"
 * — viraram os niveis da propria tabela. Quatro somas do mesmo dinheiro na
 * mesma tela faziam o olho conferir em vez de ler.
 *
 * A data da ultima posicao foi junto para o titulo da tabela: o cartao saiu,
 * mas saber se o numero e de hoje ou de tres semanas atras nao podia sair com
 * ele.
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

  return (
    <TabelaDePapeis posicoes={carteira.posicoes} vistoEm={carteira.vistoEm} />
  );
}
