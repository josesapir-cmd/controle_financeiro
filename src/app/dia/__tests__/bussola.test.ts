import { describe, expect, it } from "vitest";
import { PREENCHIMENTO, POR_VOLTA, SETA, direcaoDasTeclas } from "../bussola";

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
