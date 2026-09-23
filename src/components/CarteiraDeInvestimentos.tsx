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
  // Erro de leitura ANTES do vazio: os dois desenham a mesma tela em branco e
  // pedem coisas opostas. "Nenhuma posicao" manda sincronizar; uma consulta que
  // estourou manda rodar a migracao, e confundir as duas custou uma tarde.
  if (carteira.falhas.includes("posicoes")) {
    return (
      <section className="gr">
        <figcaption className="gr-titulo">Carteira</figcaption>
        <p className="empty" style={{ margin: 0 }}>
          Nao consegui ler as posicoes — isto <strong>nao</strong> quer dizer
          que elas sumiram. Quase sempre e migracao pendente: o app sobe sozinho
          num push e as migracoes sao rodadas a mao. Rode{" "}
          <code>npm run migrate</code> e recarregue.
        </p>
      </section>
    );
  }

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
    <>
      {/* As posicoes vieram, mas algo ao lado nao. A tabela esta certa e
          incompleta, e dizer qual parte falta e mais util que um aviso mudo. */}
      {carteira.falhas.length > 0 ? (
        <p className="empty" style={{ marginBottom: "0.75rem" }}>
          Nao consegui ler: {carteira.falhas.join(", ")}. A carteira abaixo esta
          certa, mas incompleta — provavelmente falta <code>npm run migrate</code>.
        </p>
      ) : null}
      <TabelaDePapeis posicoes={carteira.posicoes} vistoEm={carteira.vistoEm} />
    </>
  );
}
