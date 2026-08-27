import { describe, expect, it } from "vitest";
import { accountQuery, buildQuery, parseAccountIds } from "../account-selection";

describe("parseAccountIds", () => {
  it("aceita o parametro repetido, como os checkboxes enviam", () => {
    expect(parseAccountIds(["a", "b"])).toEqual(["a", "b"]);
  });

  it("aceita a forma separada por virgula", () => {
    expect(parseAccountIds("a,b")).toEqual(["a", "b"]);
  });

  it("aceita as duas formas misturadas", () => {
    expect(parseAccountIds(["a,b", "c"])).toEqual(["a", "b", "c"]);
  });

  it("remove duplicatas e espacos", () => {
    expect(parseAccountIds(" a , b ,a")).toEqual(["a", "b"]);
  });

  it("devolve vazio quando nao ha selecao", () => {
    expect(parseAccountIds(undefined)).toEqual([]);
    expect(parseAccountIds("")).toEqual([]);
  });
});

describe("accountQuery", () => {
  it("nao produz parametro quando nada esta selecionado", () => {
    expect(accountQuery([])).toBe("");
  });

  it("junta os ids por virgula", () => {
    expect(accountQuery(["a", "b"])).toBe("contas=a,b");
  });
});

describe("buildQuery", () => {
  it("ignora trechos vazios", () => {
    expect(buildQuery("from=1", "", undefined, "contas=a")).toBe("from=1&contas=a");
  });
});
