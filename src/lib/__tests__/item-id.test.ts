import { describe, expect, it } from "vitest";
import { isValidItemId, parseItemId } from "../item-id";

const ID = "fe3eb491-3896-4bb7-a292-b5881fdaa4e3";

describe("parseItemId", () => {
  it("extrai o id da URL do Meu Pluggy", () => {
    expect(parseItemId(`https://meu.pluggy.ai/connections/${ID}`)).toBe(ID);
  });

  it("aceita o UUID puro", () => {
    expect(parseItemId(ID)).toBe(ID);
  });

  it("ignora espacos em volta", () => {
    expect(parseItemId(`  ${ID}  `)).toBe(ID);
  });

  it("normaliza maiusculas", () => {
    expect(parseItemId(ID.toUpperCase())).toBe(ID);
  });

  it("lida com barra final e parametros de query", () => {
    expect(parseItemId(`https://meu.pluggy.ai/connections/${ID}/?tab=contas`)).toBe(ID);
  });

  it("devolve null quando nao ha UUID no texto", () => {
    expect(parseItemId("https://meu.pluggy.ai/connections/")).toBeNull();
    expect(parseItemId("")).toBeNull();
    expect(parseItemId("banco inter")).toBeNull();
  });
});

describe("isValidItemId", () => {
  it("recusa texto que apenas contem um UUID", () => {
    expect(isValidItemId(`prefixo-${ID}`)).toBe(false);
  });

  it("aceita o UUID isolado", () => {
    expect(isValidItemId(ID)).toBe(true);
  });
});
