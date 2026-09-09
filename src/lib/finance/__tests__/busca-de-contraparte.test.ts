import { describe, expect, it } from "vitest";
import { casaComBusca, contraparteCasa } from "../busca-de-contraparte";

describe("casaComBusca", () => {
  it("acha por um pedaco do nome", () => {
    expect(casaComBusca("MERCADO SAO JOSE LTDA", "mercado")).toBe(true);
    expect(casaComBusca("MERCADO SAO JOSE LTDA", "jose")).toBe(true);
  });

  it("aceita os pedacos em qualquer ordem", () => {
    // Quem digita "silva jose" esta procurando "JOSE ... SILVA ...". Exigir a
    // ordem devolveria nada, e a pessoa concluiria que nao existe.
    expect(casaComBusca("JOSE MANUEL SILVA SAPIR", "silva jose")).toBe(true);
  });

  it("exige TODOS os pedacos, e nao qualquer um", () => {
    // Casar por "ou" faria uma busca de duas palavras devolver mais resultados
    // que a de uma, que e o contrario do que refinar significa.
    expect(casaComBusca("MERCADO SAO JOSE", "mercado paulista")).toBe(false);
  });

  it("ignora acento e caixa dos dois lados", () => {
    expect(casaComBusca("Ótica São José", "otica sao jose")).toBe(true);
    expect(casaComBusca("otica sao jose", "Ótica")).toBe(true);
  });

  it("ignora espaco sobrando", () => {
    expect(casaComBusca("MERCADO SAO JOSE", "  mercado   jose  ")).toBe(true);
  });

  it("termo vazio nao casa com nada", () => {
    // Buscar por nada nao pode significar buscar por tudo: a tela usa este
    // retorno para decidir se ha busca ativa.
    expect(casaComBusca("QUALQUER COISA", "")).toBe(false);
    expect(casaComBusca("QUALQUER COISA", "   ")).toBe(false);
  });

  it("alvo ausente nao estoura", () => {
    expect(casaComBusca(null, "jose")).toBe(false);
    expect(casaComBusca(undefined, "jose")).toBe(false);
  });
});

describe("contraparteCasa", () => {
  it("procura no apelido, no nome oficial e no exibido", () => {
    const c = { name: "Padaria", officialName: "PANIFICADORA BELLA LTDA", alias: "Padaria" };

    expect(contraparteCasa(c, "padaria")).toBe(true);
    expect(contraparteCasa(c, "panificadora")).toBe(true);
    expect(contraparteCasa(c, "bella")).toBe(true);
  });

  it("nao acha o que nao esta em nenhum dos nomes", () => {
    expect(contraparteCasa({ name: "Padaria" }, "farmacia")).toBe(false);
  });
});
