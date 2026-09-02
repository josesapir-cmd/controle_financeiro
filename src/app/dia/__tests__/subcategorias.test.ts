import { describe, expect, it } from "vitest";
import { completarSubcategoria, filtrarSubcategorias } from "../subcategorias";

const CENTROS = [
  { name: "Viagem Bariloche" },
  { name: "Servico de vidro" },
  { name: "Vinho" },
  { name: "Ferias" },
];

describe("filtrarSubcategorias", () => {
  it("campo vazio mostra todas, na ordem em que existem", () => {
    // E a lista do que existe, que e o que se quer ver antes de digitar.
    expect(filtrarSubcategorias(CENTROS, "")).toEqual([
      "Viagem Bariloche",
      "Servico de vidro",
      "Vinho",
      "Ferias",
    ]);
    expect(filtrarSubcategorias(CENTROS, "   ")).toHaveLength(4);
  });

  it("quem comeca com o texto vem antes de quem so o contem", () => {
    // Digitar "vi" quer "Viagem", nao "Servico de vidro".
    expect(filtrarSubcategorias(CENTROS, "vi")).toEqual([
      "Viagem Bariloche",
      "Vinho",
      "Servico de vidro",
    ]);
  });

  it("ignora acento e caixa nos dois lados", () => {
    expect(filtrarSubcategorias(CENTROS, "FÉR")).toEqual(["Ferias"]);
    expect(filtrarSubcategorias([{ name: "Férias" }], "feri")).toEqual(["Férias"]);
  });

  it("nada combina devolve lista vazia, e nao a lista inteira", () => {
    // Devolver tudo faria o enter escolher um nome que ninguem digitou.
    expect(filtrarSubcategorias(CENTROS, "zzz")).toEqual([]);
  });

  it("categoria sem subcategoria nenhuma nao quebra", () => {
    expect(filtrarSubcategorias([], "qualquer")).toEqual([]);
    expect(filtrarSubcategorias([], "")).toEqual([]);
  });

  it("nao repete quem casa das duas formas", () => {
    const centros = [{ name: "Vinho do Porto" }];
    expect(filtrarSubcategorias(centros, "vinho")).toEqual(["Vinho do Porto"]);
  });
});

describe("completarSubcategoria", () => {
  const CENTROS = [
    { name: "Viagem Bariloche" },
    { name: "Servico de vidro" },
    { name: "Vinho" },
    { name: "Férias" },
  ];

  it("completa pelo comeco", () => {
    expect(completarSubcategoria(CENTROS, "via")).toBe("Viagem Bariloche");
  });

  it("nao completa para quem so contem o texto", () => {
    // Completar "vid" para "Servico de vidro" trocaria o que a pessoa esta
    // escrevendo por outra coisa no meio da digitacao.
    expect(completarSubcategoria(CENTROS, "vid")).toBeNull();
  });

  it("o primeiro da lista vence quando dois comecam igual", () => {
    expect(completarSubcategoria(CENTROS, "vi")).toBe("Viagem Bariloche");
  });

  it("devolve o nome do cadastro, com o acento dele", () => {
    // E aquele registro que vai ser usado, nao um homonimo sem acento.
    expect(completarSubcategoria(CENTROS, "fe")).toBe("Férias");
    expect(completarSubcategoria(CENTROS, "FÉR")).toBe("Férias");
  });

  it("nome ja completo nao se completa de novo", () => {
    // Sem isto o campo ficaria com a selecao vazia piscando a cada tecla.
    expect(completarSubcategoria(CENTROS, "Vinho")).toBeNull();
    expect(completarSubcategoria(CENTROS, "vinho")).toBeNull();
  });

  it("campo vazio nao completa nada", () => {
    // Completar no primeiro caractere ainda nao digitado seria escolher por
    // quem nem comecou a escrever.
    expect(completarSubcategoria(CENTROS, "")).toBeNull();
    expect(completarSubcategoria(CENTROS, "  ")).toBeNull();
  });

  it("sem correspondencia, nao completa", () => {
    expect(completarSubcategoria(CENTROS, "zzz")).toBeNull();
    expect(completarSubcategoria([], "vi")).toBeNull();
  });
});
