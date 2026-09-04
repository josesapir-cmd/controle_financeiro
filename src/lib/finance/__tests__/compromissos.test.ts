import { describe, expect, it } from "vitest";
import type { ChamadaRow, CompromissoRow } from "@/lib/db/repository";
import { montarCarteira } from "../compromissos";

function fundo(id: string, nome: string, comprometido: number): CompromissoRow {
  return { id, name: nome, committed: comprometido, signedOn: null, note: null, closed: false };
}

function chamada(id: string, fundoId: string, data: string, valor: number): ChamadaRow {
  return { id, commitmentId: fundoId, calledOn: data, amount: valor, note: null };
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
    expect(carteira).toEqual({ fundos: [], comprometido: 0, chamado: 0, aChamar: 0 });
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
