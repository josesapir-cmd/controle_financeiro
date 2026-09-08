import { describe, expect, it } from "vitest";
import { classificar, estaClassificado } from "../classificacao";

const cat = (categoryId: string | null, costCenterId: string | null = null) => ({
  categoryId,
  costCenterId,
});

describe("classificar", () => {
  it("a decisao sobre o proprio lancamento vence todas", () => {
    const resultado = classificar({
      proprio: cat("a"),
      cartao: cat("b"),
      contraparte: cat("c"),
    });

    expect(resultado).toEqual({ categoryId: "a", costCenterId: null, origem: "proprio" });
  });

  it("a regra do cartao vence a heranca da contraparte", () => {
    // Uma compra de supermercado no cartao do pai continua sendo gasto do pai,
    // por mais que a contraparte diga alimentacao: origem nao muda.
    const resultado = classificar({ cartao: cat("b"), contraparte: cat("c") });
    expect(resultado.origem).toBe("cartao");
    expect(resultado.categoryId).toBe("b");
  });

  it("sem as duas primeiras, a contraparte classifica", () => {
    expect(classificar({ contraparte: cat("c") }).origem).toBe("contraparte");
  });

  it("nada classificando devolve origem nula, e nao uma categoria falsa", () => {
    expect(classificar({})).toEqual({ categoryId: null, costCenterId: null, origem: null });
  });

  it("atribuicao vazia nao conta como classificacao", () => {
    // Uma linha de rotulo pode existir so por causa do comentario, sem
    // categoria nenhuma. Trata-la como classificada esconderia a pendencia.
    const resultado = classificar({ proprio: cat(null), contraparte: cat("c") });
    expect(resultado.origem).toBe("contraparte");
  });

  it("so o centro de custo ja e classificacao", () => {
    // O centro carrega a categoria dele: quem escolheu "Bariloche 2026"
    // escolheu Viagens junto.
    const resultado = classificar({ proprio: cat(null, "centro-1") });
    expect(resultado.origem).toBe("proprio");
    expect(resultado.costCenterId).toBe("centro-1");
  });

  it("o centro sobrevive junto com a categoria da origem que venceu", () => {
    const resultado = classificar({ cartao: cat("b", "centro-2"), contraparte: cat("c") });
    expect(resultado).toEqual({ categoryId: "b", costCenterId: "centro-2", origem: "cartao" });
  });

  it("nao mistura pedacos de origens diferentes", () => {
    // O centro da contraparte nao pode grudar na categoria do cartao: seriam
    // duas decisoes distintas viradas numa terceira que ninguem tomou.
    const resultado = classificar({ cartao: cat("b"), contraparte: cat("c", "centro-3") });
    expect(resultado.costCenterId).toBeNull();
  });
});

describe("estaClassificado", () => {
  it("responde pela existencia de qualquer origem", () => {
    expect(estaClassificado({ contraparte: cat("c") })).toBe(true);
    expect(estaClassificado({ cartao: cat(null, "centro") })).toBe(true);
    expect(estaClassificado({})).toBe(false);
    expect(estaClassificado({ proprio: cat(null, null) })).toBe(false);
  });
});
