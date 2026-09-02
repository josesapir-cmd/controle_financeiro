import { describe, expect, it } from "vitest";
import { filtrarSubcategorias } from "../subcategorias";

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
