import { describe, expect, it } from "vitest";
import { recuar, squarify, type Retangulo } from "../treemap";

function areaTotal(rects: Retangulo[]): number {
  return rects.reduce((soma, r) => soma + r.w * r.h, 0);
}

function seSobrepoe(a: Retangulo, b: Retangulo): boolean {
  const folga = 1e-9;
  return (
    a.x + a.w > b.x + folga &&
    b.x + b.w > a.x + folga &&
    a.y + a.h > b.y + folga &&
    b.y + b.h > a.y + folga
  );
}

const ITENS = [
  { id: "a", valor: 50 },
  { id: "b", valor: 25 },
  { id: "c", valor: 15 },
  { id: "d", valor: 7 },
  { id: "e", valor: 3 },
];

describe("squarify", () => {
  it("preenche a caixa inteira: a soma das areas e a area da caixa", () => {
    // E o que permite ler "este bloco e um quinto do retangulo" como fracao.
    expect(areaTotal(squarify(ITENS, 100, 60))).toBeCloseTo(6000, 6);
  });

  it("da area proporcional ao valor", () => {
    const rects = squarify(ITENS, 100, 100);
    const porId = Object.fromEntries(rects.map((r) => [r.id, r.w * r.h]));

    expect(porId.a / porId.b).toBeCloseTo(2, 6);
    expect(porId.b / porId.c).toBeCloseTo(25 / 15, 6);
  });

  it("nao sobrepoe retangulos", () => {
    const rects = squarify(ITENS, 120, 80);

    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        expect(seSobrepoe(rects[i], rects[j])).toBe(false);
      }
    }
  });

  it("mantem todo mundo dentro da caixa", () => {
    for (const r of squarify(ITENS, 120, 80)) {
      expect(r.x).toBeGreaterThanOrEqual(-1e-9);
      expect(r.y).toBeGreaterThanOrEqual(-1e-9);
      expect(r.x + r.w).toBeLessThanOrEqual(120 + 1e-9);
      expect(r.y + r.h).toBeLessThanOrEqual(80 + 1e-9);
    }
  });

  it("ordena do maior para o menor", () => {
    expect(squarify(ITENS, 100, 100).map((r) => r.id)).toEqual(["a", "b", "c", "d", "e"]);
  });

  // Retangulo muito alongado engana a comparacao de area e nao cabe rotulo.
  it("mantem os blocos longe de tiras finas", () => {
    const rects = squarify(ITENS, 100, 100);
    const razoes = rects.map((r) => Math.max(r.w / r.h, r.h / r.w));

    expect(Math.max(...razoes)).toBeLessThan(4);
  });

  it("um item so ocupa a caixa toda", () => {
    expect(squarify([{ id: "unico", valor: 9 }], 40, 25)).toEqual([
      { id: "unico", x: 0, y: 0, w: 40, h: 25 },
    ]);
  });

  it("descarta valor zero e negativo, que nao tem area", () => {
    const rects = squarify(
      [{ id: "a", valor: 10 }, { id: "b", valor: 0 }, { id: "c", valor: -5 }],
      50,
      50,
    );

    expect(rects.map((r) => r.id)).toEqual(["a"]);
  });

  it("devolve vazio para entrada vazia ou caixa sem area", () => {
    expect(squarify([], 100, 100)).toEqual([]);
    expect(squarify(ITENS, 0, 100)).toEqual([]);
    expect(squarify(ITENS, 100, -1)).toEqual([]);
  });

  it("aguenta muitos itens sem estourar", () => {
    const muitos = Array.from({ length: 200 }, (_, i) => ({ id: `i${i}`, valor: i + 1 }));
    const rects = squarify(muitos, 300, 200);

    expect(rects).toHaveLength(200);
    expect(areaTotal(rects)).toBeCloseTo(60000, 4);
  });

  it("e estavel: mesma entrada, mesma saida", () => {
    expect(squarify(ITENS, 100, 60)).toEqual(squarify(ITENS, 100, 60));
  });
});

describe("recuar", () => {
  it("encolhe pelos quatro lados", () => {
    expect(recuar({ id: "a", x: 10, y: 20, w: 100, h: 50 }, 2)).toEqual({
      id: "a",
      x: 12,
      y: 22,
      w: 96,
      h: 46,
    });
  });

  it("nao produz tamanho negativo em bloco menor que a margem", () => {
    const r = recuar({ id: "a", x: 0, y: 0, w: 3, h: 1 }, 2);

    expect(r.w).toBe(0);
    expect(r.h).toBe(0);
  });
});
