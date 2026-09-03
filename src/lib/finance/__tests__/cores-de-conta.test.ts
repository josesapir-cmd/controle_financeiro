import { describe, expect, it } from "vitest";
import {
  coresPorConta,
  corDaInstituicao,
  corDeGrafico,
  ordenarParaContraste,
} from "../cores-de-conta";

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

describe("corDeGrafico", () => {
  it("preserva a matiz da marca", () => {
    // E a matiz que carrega o reconhecimento: o roxo do Nubank continua roxo,
    // so com a claridade que um preenchimento de grafico exige.
    expect(corDeGrafico("Nubank")).toMatch(/^oklch\(0\.6 0\.15 30[0-9]\.\d\)$/);
    expect(corDeGrafico("Banco Inter")).toMatch(/^oklch\(0\.6 0\.15 5[0-9]\.\d\)$/);
  });

  it("da claridade e croma fixos a todas", () => {
    // A cor de marca sozinha nao serve: o azul-marinho do Personnalite fica
    // quase preto como preenchimento e o laranja do Inter perde contraste.
    for (const banco of ["Nubank", "Itau Personnalite", "BTG Pactual", "Banco Inter"]) {
      expect(corDeGrafico(banco)).toMatch(/^oklch\(0\.6 0\.15 /);
    }
  });

  it("banco desconhecido tambem ganha passo de grafico", () => {
    expect(corDeGrafico("Banco Que Nao Existe")).toMatch(/^oklch\(0\.6 0\.15 /);
    expect(corDeGrafico("")).toMatch(/^oklch\(0\.6 0\.15 /);
  });

  it("e estavel: a mesma conta, a mesma cor", () => {
    expect(corDeGrafico("Nubank")).toBe(corDeGrafico("Nu Pagamentos S.A."));
  });
});

describe("ordenarParaContraste", () => {
  const matiz = (item: { h: number }) => item.h;

  it("afasta as matizes parecidas", () => {
    // Personnalite (258) e BTG (236) sao indistinguiveis encostados. Separados
    // por uma terceira faixa, deixam de ser.
    const contas = [{ h: 304 }, { h: 51 }, { h: 258 }, { h: 236 }, { h: 135 }];
    const ordem = ordenarParaContraste(contas, matiz);

    const i258 = ordem.findIndex((c) => c.h === 258);
    const i236 = ordem.findIndex((c) => c.h === 236);
    expect(Math.abs(i258 - i236)).toBeGreaterThan(1);
  });

  it("nao perde nem repete ninguem", () => {
    const contas = [{ h: 10 }, { h: 90 }, { h: 170 }, { h: 250 }, { h: 330 }];
    const ordem = ordenarParaContraste(contas, matiz);

    expect(ordem).toHaveLength(5);
    expect(new Set(ordem.map((c) => c.h)).size).toBe(5);
  });

  it("uma ou duas contas nao tem o que ordenar", () => {
    expect(ordenarParaContraste([{ h: 10 }], matiz)).toEqual([{ h: 10 }]);
    expect(ordenarParaContraste([{ h: 10 }, { h: 20 }], matiz)).toHaveLength(2);
    expect(ordenarParaContraste([], matiz)).toEqual([]);
  });

  it("a distancia da a volta no circulo", () => {
    // 350 e 10 estao a 20 graus, nao a 340. Com tres itens as duas parecidas
    // tem de ficar nas pontas, com a distante no meio — e o melhor que existe.
    const ordem = ordenarParaContraste([{ h: 350 }, { h: 10 }, { h: 170 }], matiz);
    expect(ordem[1].h).toBe(170);
  });

  it("escolhe a ordem otima, nao a primeira que serve", () => {
    // O guloso poe a matiz isolada na ponta e deixa as duas parecidas juntas no
    // fim; a busca exaustiva nao.
    const contas = [{ h: 0 }, { h: 20 }, { h: 180 }, { h: 200 }];
    const ordem = ordenarParaContraste(contas, matiz);

    const vizinhos = ordem.slice(1).map((c, i) => {
      const bruta = Math.abs(ordem[i].h - c.h) % 360;
      return bruta > 180 ? 360 - bruta : bruta;
    });
    expect(Math.min(...vizinhos)).toBeGreaterThanOrEqual(160);
  });
});
