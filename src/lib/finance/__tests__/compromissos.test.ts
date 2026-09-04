import { describe, expect, it } from "vitest";
import type { ChamadaRow, CompromissoRow } from "@/lib/db/repository";
import { montarCarteira } from "../compromissos";

function fundo(id: string, nome: string, comprometido: number): CompromissoRow {
  return { id, name: nome, committed: comprometido, signedOn: null, note: null, closed: false };
}

function chamada(
  id: string,
  fundoId: string,
  data: string,
  valor: number,
  liquidada = true,
): ChamadaRow {
  return { id, commitmentId: fundoId, calledOn: data, amount: valor, note: null, liquidada };
}

describe("montarCarteira", () => {
  it("soma as chamadas de cada fundo e diz o que falta chamar", () => {
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 500000), fundo("b", "Beta", 200000)],
      [
        chamada("1", "a", "2026-04-10", 50000),
        chamada("2", "a", "2026-08-02", 75000),
        chamada("3", "b", "2026-05-01", 200000),
      ],
    );

    const [alfa, beta] = carteira.fundos;
    expect(alfa.chamado).toBe(125000);
    expect(alfa.aChamar).toBe(375000);
    expect(alfa.fatiaChamada).toBeCloseTo(0.25);
    expect(beta.aChamar).toBe(0);
    expect(beta.fatiaChamada).toBe(1);
  });

  it("fundo sem chamada aparece com o compromisso inteiro a chamar", () => {
    const [alfa] = montarCarteira([fundo("a", "Alfa", 500000)], []).fundos;

    expect(alfa.chamado).toBe(0);
    expect(alfa.aChamar).toBe(500000);
    expect(alfa.fatiaChamada).toBe(0);
    expect(alfa.chamadas).toEqual([]);
  });

  it("chamada acima do compromisso vira aviso, nao um saldo negativo", () => {
    // Acontece de verdade: taxa cobrada acima do compromisso, ou valor digitado
    // errado. Um `aChamar` de -20 mil ninguem le como erro.
    const [alfa] = montarCarteira(
      [fundo("a", "Alfa", 100000)],
      [chamada("1", "a", "2026-04-10", 120000)],
    ).fundos;

    expect(alfa.excedido).toBe(true);
    expect(alfa.aChamar).toBe(0);
    expect(alfa.fatiaChamada).toBe(1);
  });

  it("o total a chamar nao e abatido pelo fundo que estourou", () => {
    // Somar `comprometido - chamado` daria 90 mil e esconderia que ainda ha
    // 100 mil que podem ser chamados a qualquer momento.
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 100000), fundo("b", "Beta", 100000)],
      [chamada("1", "a", "2026-04-10", 110000)],
    );

    expect(carteira.comprometido).toBe(200000);
    expect(carteira.chamado).toBe(110000);
    expect(carteira.aChamar).toBe(100000);
  });

  it("nao confunde chamadas de fundos diferentes", () => {
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 100000), fundo("b", "Beta", 100000)],
      [chamada("1", "b", "2026-04-10", 40000)],
    );

    expect(carteira.fundos[0].chamado).toBe(0);
    expect(carteira.fundos[1].chamado).toBe(40000);
  });

  it("carteira vazia soma zero em vez de dividir por zero", () => {
    const carteira = montarCarteira([], []);
    expect(carteira).toEqual({
      fundos: [],
      comprometido: 0,
      chamado: 0,
      liquidado: 0,
      aLiquidar: 0,
      aChamar: 0,
      aPagar: 0,
    });
  });

  it("compromisso zerado nao produz NaN na fatia", () => {
    const [alfa] = montarCarteira(
      [{ ...fundo("a", "Alfa", 0), committed: 0 }],
      [chamada("1", "a", "2026-04-10", 10)],
    ).fundos;

    expect(alfa.fatiaChamada).toBe(0);
    expect(Number.isNaN(alfa.fatiaChamada)).toBe(false);
  });
});

describe("acumulado das chamadas", () => {
  it("soma em ordem cronologica, qualquer que seja a ordem que chegou", () => {
    // A consulta hoje devolve da mais recente para a mais antiga. Se o
    // acumulado dependesse dessa ordem, um ORDER BY diferente amanha o deixaria
    // errado sem quebrar teste nenhum.
    const [alfa] = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [
        chamada("3", "a", "2026-08-02", 75000),
        chamada("1", "a", "2026-04-10", 50000),
        chamada("2", "a", "2026-06-01", 25000),
      ],
    ).fundos;

    expect(alfa.chamadas.map((c) => [c.data, c.acumulado])).toEqual([
      ["2026-04-10", 50000],
      ["2026-06-01", 75000],
      ["2026-08-02", 150000],
    ]);
  });

  it("o ultimo acumulado e o total chamado do fundo", () => {
    const [alfa] = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [chamada("1", "a", "2026-04-10", 50000), chamada("2", "a", "2026-06-01", 25000)],
    ).fundos;

    expect(alfa.chamadas[alfa.chamadas.length - 1].acumulado).toBe(alfa.chamado);
  });

  it("duas chamadas no mesmo dia nao embaralham o acumulado", () => {
    const [alfa] = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [chamada("b", "a", "2026-04-10", 20000), chamada("a", "a", "2026-04-10", 30000)],
    ).fundos;

    expect(alfa.chamadas.map((c) => c.acumulado)).toEqual([30000, 50000]);
  });
});

describe("liquidacao na carteira", () => {
  it("separa o que foi chamado do que ja saiu", () => {
    // "Chamado" e a obrigacao; "liquidado" e o dinheiro que de fato esta la. A
    // diferenca entre os dois e a conta a pagar que a tela precisa mostrar.
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [
        chamada("1", "a", "2026-04-10", 50000, true),
        chamada("2", "a", "2026-08-02", 30000, false),
      ],
    );

    const [alfa] = carteira.fundos;
    expect(alfa.chamado).toBe(80000);
    expect(alfa.liquidado).toBe(50000);
    expect(alfa.aLiquidar).toBe(30000);
    expect(carteira.liquidado).toBe(50000);
    expect(carteira.aLiquidar).toBe(30000);
  });

  it("chamada pendente continua abatendo o que falta chamar", () => {
    // O gestor ja pediu: aquele dinheiro nao pode ser contado duas vezes como
    // "ainda pode ser chamado de surpresa".
    const [alfa] = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [chamada("1", "a", "2026-04-10", 50000, false)],
    ).fundos;

    expect(alfa.aChamar).toBe(450000);
  });

  it("ordena os fundos do maior compromisso para o menor", () => {
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 100000), fundo("b", "Beta", 900000), fundo("c", "Gama", 400000)],
      [],
    );

    expect(carteira.fundos.map((f) => f.nome)).toEqual(["Beta", "Gama", "Alfa"]);
  });

  it("compromissos de mesmo tamanho saem em ordem alfabetica, e nao ao acaso", () => {
    const carteira = montarCarteira(
      [fundo("a", "Zeta", 100000), fundo("b", "Alfa", 100000)],
      [],
    );

    expect(carteira.fundos.map((f) => f.nome)).toEqual(["Alfa", "Zeta"]);
  });
});

describe("total a pagar", () => {
  it("soma o que falta chamar com o que foi chamado e nao liquidou", () => {
    // E o numero de caixa: os dois pedacos vao sair, so nao se sabe quando o
    // primeiro. Olhar so um deles subestima a obrigacao.
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [
        chamada("1", "a", "2026-04-10", 100000, true),
        chamada("2", "a", "2026-08-02", 40000, false),
      ],
    );

    expect(carteira.aChamar).toBe(360000);
    expect(carteira.aLiquidar).toBe(40000);
    expect(carteira.aPagar).toBe(400000);
  });

  it("com tudo liquidado, o a pagar e so o que falta chamar", () => {
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [chamada("1", "a", "2026-04-10", 100000, true)],
    );

    expect(carteira.aPagar).toBe(carteira.aChamar);
  });

  it("compromisso inteiro chamado e liquidado nao deixa nada a pagar", () => {
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 500000)],
      [chamada("1", "a", "2026-04-10", 500000, true)],
    );

    expect(carteira.aPagar).toBe(0);
  });

  it("chamada acima do compromisso e pendente continua sendo conta a pagar", () => {
    // O "a chamar" e zero porque o compromisso ja estourou, mas o dinheiro da
    // chamada pendente ainda tem de sair.
    const carteira = montarCarteira(
      [fundo("a", "Alfa", 100000)],
      [chamada("1", "a", "2026-04-10", 120000, false)],
    );

    expect(carteira.aChamar).toBe(0);
    expect(carteira.aPagar).toBe(120000);
  });
});
