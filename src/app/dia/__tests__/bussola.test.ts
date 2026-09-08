import { describe, expect, it } from "vitest";
import { PREENCHIMENTO, POR_VOLTA, SETA, direcaoDasTeclas, ondeEsta } from "../bussola";

function teclas(...nomes: string[]): ReadonlySet<string> {
  return new Set(nomes);
}

describe("direcaoDasTeclas", () => {
  it("uma seta aponta para o lado", () => {
    expect(direcaoDasTeclas(teclas("ArrowUp"))).toBe("N");
    expect(direcaoDasTeclas(teclas("ArrowRight"))).toBe("E");
    expect(direcaoDasTeclas(teclas("ArrowDown"))).toBe("S");
    expect(direcaoDasTeclas(teclas("ArrowLeft"))).toBe("W");
  });

  it("duas setas juntas fazem a diagonal", () => {
    expect(direcaoDasTeclas(teclas("ArrowUp", "ArrowRight"))).toBe("NE");
    expect(direcaoDasTeclas(teclas("ArrowDown", "ArrowRight"))).toBe("SE");
    expect(direcaoDasTeclas(teclas("ArrowDown", "ArrowLeft"))).toBe("SW");
    expect(direcaoDasTeclas(teclas("ArrowUp", "ArrowLeft"))).toBe("NW");
  });

  it("a ordem em que as setas desceram nao muda a diagonal", () => {
    expect(direcaoDasTeclas(teclas("ArrowRight", "ArrowUp"))).toBe("NE");
  });

  it("setas opostas se cancelam em vez de escolherem um lado", () => {
    // Chutar um lado classificaria a despesa num lugar que ninguem pediu.
    expect(direcaoDasTeclas(teclas("ArrowLeft", "ArrowRight"))).toBeNull();
    expect(direcaoDasTeclas(teclas("ArrowUp", "ArrowDown"))).toBeNull();
  });

  it("um eixo cancelado deixa o outro valer", () => {
    expect(direcaoDasTeclas(teclas("ArrowLeft", "ArrowRight", "ArrowUp"))).toBe("N");
    expect(direcaoDasTeclas(teclas("ArrowUp", "ArrowDown", "ArrowLeft"))).toBe("W");
  });

  it("as quatro juntas nao apontam para nada", () => {
    expect(
      direcaoDasTeclas(teclas("ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight")),
    ).toBeNull();
  });

  it("nenhuma seta, nenhuma direcao", () => {
    expect(direcaoDasTeclas(teclas())).toBeNull();
    expect(direcaoDasTeclas(teclas("Enter", "Shift"))).toBeNull();
  });
});

describe("preenchimento da bussola", () => {
  it("cobre as oito direcoes, sem repetir", () => {
    expect(new Set(PREENCHIMENTO).size).toBe(8);
    expect(POR_VOLTA).toBe(8);
  });

  it("as quatro primeiras sao as de uma tecla so", () => {
    // E o ganho ergonomico da ordem: a categoria mais usada custa uma tecla.
    expect(PREENCHIMENTO.slice(0, 4)).toEqual(["N", "E", "S", "W"]);
  });

  it("toda direcao tem seta desenhada", () => {
    for (const direcao of PREENCHIMENTO) {
      expect(SETA[direcao]).toBeTruthy();
    }
  });

  it("a seta desenhada bate com as teclas que produzem a direcao", () => {
    // A dica na tela nao pode ensinar um atalho que nao funciona.
    const porSeta: Record<string, string[]> = {
      "↑": ["ArrowUp"],
      "→": ["ArrowRight"],
      "↓": ["ArrowDown"],
      "←": ["ArrowLeft"],
      "↑→": ["ArrowUp", "ArrowRight"],
      "↓→": ["ArrowDown", "ArrowRight"],
      "↓←": ["ArrowDown", "ArrowLeft"],
      "↑←": ["ArrowUp", "ArrowLeft"],
    };

    for (const direcao of PREENCHIMENTO) {
      expect(direcaoDasTeclas(teclas(...porSeta[SETA[direcao]]))).toBe(direcao);
    }
  });
});

describe("ondeEsta", () => {
  const bussola = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` }));

  it("acha a categoria na primeira volta, na direcao que ela ocupa", () => {
    expect(ondeEsta(bussola, "c0")).toEqual({ pagina: 0, direcao: "N" });
    expect(ondeEsta(bussola, "c1")).toEqual({ pagina: 0, direcao: "E" });
    expect(ondeEsta(bussola, "c7")).toEqual({ pagina: 0, direcao: "NW" });
  });

  it("acha a categoria que caiu na segunda volta", () => {
    // Saude e Educacao vivem na pagina 1: a sugestao tem de virar a pagina
    // junto, senao ela aponta para uma direcao que a tela nao mostra.
    expect(ondeEsta(bussola, "c8")).toEqual({ pagina: 1, direcao: "N" });
    expect(ondeEsta(bussola, "c9")).toEqual({ pagina: 1, direcao: "E" });
  });

  it("categoria fora da bussola nao aponta para lugar nenhum", () => {
    // Arquivada, ou de outro tipo. Apontar para uma posicao qualquer seria
    // pior que nao apontar.
    expect(ondeEsta(bussola, "nao-existe")).toBeNull();
    expect(ondeEsta(bussola, null)).toBeNull();
    expect(ondeEsta(bussola, undefined)).toBeNull();
    expect(ondeEsta([], "c0")).toBeNull();
  });
});
