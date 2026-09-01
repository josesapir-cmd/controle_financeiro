import { describe, expect, it } from "vitest";
import { coresPorConta, corDaInstituicao } from "../cores-de-conta";

describe("corDaInstituicao", () => {
  it("da a cor da marca aos bancos conhecidos", () => {
    expect(corDaInstituicao("Nubank")).toBe("#820ad1");
    expect(corDaInstituicao("Banco Inter")).toBe("#ff7a00");
  });

  it("reconhece o nome cru que a Pluggy passou a mandar", () => {
    // Foi essa troca de nome que dividiu a conta do Nubank em duas linhas; a
    // cor nao pode depender do formato exato do nome.
    expect(corDaInstituicao("Nu Pagamentos S.A. - Instituicao de Pagamento")).toBe("#820ad1");
  });

  it("ignora acento, caixa e pontuacao", () => {
    expect(corDaInstituicao("ITAÚ PERSONNALITÉ")).toBe(corDaInstituicao("itau personnalite"));
  });

  it("separa Personnalite do Itau comum", () => {
    // O trecho mais especifico vem antes na tabela; invertido, o Personnalite
    // herdaria o laranja do Itau.
    expect(corDaInstituicao("Itau Personnalite")).toBe("#002b5c");
    expect(corDaInstituicao("Itau Unibanco")).toBe("#ec7000");
  });

  it("da cor propria e estavel a banco desconhecido", () => {
    const primeira = corDaInstituicao("Banco Que Nao Existe");
    expect(primeira).toBe(corDaInstituicao("Banco Que Nao Existe"));
    expect(primeira).toMatch(/^oklch\(/);
    expect(primeira).not.toBe(corDaInstituicao("Outro Banco Qualquer"));
  });

  it("nao quebra com nome vazio", () => {
    expect(corDaInstituicao("")).toMatch(/^oklch\(/);
    expect(corDaInstituicao("   ")).toBe(corDaInstituicao(""));
  });
});

describe("coresPorConta", () => {
  it("da a mesma cor as contas do mesmo banco", () => {
    const mapa = coresPorConta([
      { id: "a", connectorName: "Nubank" },
      { id: "b", connectorName: "Nubank" },
      { id: "c", connectorName: "Banco Inter" },
    ]);

    expect(mapa.a).toBe(mapa.b);
    expect(mapa.c).not.toBe(mapa.a);
  });

  it("devolve mapa vazio sem contas", () => {
    expect(coresPorConta([])).toEqual({});
  });
});
