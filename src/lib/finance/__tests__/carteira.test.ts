import { describe, expect, it } from "vitest";
import { agrupar, classeDoPapel, type PapelNaCarteira } from "../carteira";

/**
 * O nome e o agrupamento dos papeis da carteira.
 *
 * A Pluggy manda codigo do Open Finance; a tela precisa de portugues. E o
 * agrupamento tem uma regra que erra calado: um papel que caisse em dois
 * grupos, ou um total que nao fecha com a soma dos saldos.
 */

function papel(parcial: Partial<PapelNaCarteira>): PapelNaCarteira {
  return {
    id: "x",
    nome: "Papel",
    instituicao: "BTG Pactual",
    tipo: "FIXED_INCOME",
    subtipo: null,
    saldo: 0,
    aportado: null,
    lucro: null,
    taxa: null,
    vence: null,
    ...parcial,
  };
}

describe("classeDoPapel", () => {
  it("prefere o subtipo, que e o rotulo mais especifico", () => {
    expect(classeDoPapel("FIXED_INCOME", "CDB")).toBe("CDB");
    expect(classeDoPapel("MUTUAL_FUND", "MULTIMARKET_FUND")).toBe(
      "Fundo multimercado",
    );
  });

  it("cai no tipo quando o subtipo nao tem traducao", () => {
    expect(classeDoPapel("FIXED_INCOME", "ALGO_NOVO")).toBe("Renda fixa");
    expect(classeDoPapel("MUTUAL_FUND", null)).toBe("Fundo");
  });

  it("mostra o codigo cru em vez de inventar um nome", () => {
    // Um codigo desconhecido aparecendo na tela e um pedido de traducao; um
    // "Outros" generico esconderia que existe algo novo.
    expect(classeDoPapel("CRYPTO", "BITCOIN")).toBe("BITCOIN");
    expect(classeDoPapel("CRYPTO", null)).toBe("CRYPTO");
  });
});

describe("agrupar", () => {
  const papeis = [
    papel({ id: "a", subtipo: "CDB", saldo: 1000 }),
    papel({ id: "b", subtipo: "CDB", saldo: 500 }),
    papel({ id: "c", subtipo: "TREASURY", saldo: 3000 }),
    papel({
      id: "d",
      tipo: "MUTUAL_FUND",
      subtipo: "MULTIMARKET_FUND",
      saldo: 200,
    }),
  ];

  it("soma saldo e conta papeis por classe", () => {
    const grupos = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));

    expect(grupos).toEqual([
      { nome: "Tesouro Direto", total: 3000, papeis: 1 },
      { nome: "CDB", total: 1500, papeis: 2 },
      { nome: "Fundo multimercado", total: 200, papeis: 1 },
    ]);
  });

  it("ordena do maior total para o menor", () => {
    const grupos = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));
    expect(grupos.map((g) => g.total)).toEqual([3000, 1500, 200]);
  });

  it("nao perde nem duplica saldo: a soma dos grupos e a soma dos papeis", () => {
    const porClasse = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));
    const porInstituicao = agrupar(papeis, (p) => p.instituicao);
    const total = papeis.reduce((s, p) => s + p.saldo, 0);

    expect(porClasse.reduce((s, g) => s + g.total, 0)).toBe(total);
    expect(porInstituicao.reduce((s, g) => s + g.total, 0)).toBe(total);
    expect(porInstituicao).toHaveLength(1);
  });

  it("nao inventa grupo quando nao ha papel", () => {
    expect(agrupar([], (p) => p.instituicao)).toEqual([]);
  });
});
