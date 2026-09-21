import { describe, expect, it } from "vitest";
import { formatPercent } from "../money";

/**
 * Formatacao de porcentagem.
 *
 * O app inteiro fala pt-BR e escreve dinheiro com virgula. `toFixed` devolve
 * ponto, e a diferenca so aparece quando os dois numeros ficam na mesma linha.
 */

describe("formatPercent", () => {
  it("usa virgula, como o resto dos numeros da tela", () => {
    expect(formatPercent(55.7)).toBe("55,7");
    expect(formatPercent(13.45, 2)).toBe("13,45");
  });

  it("mantem as casas pedidas mesmo em numero redondo", () => {
    // "100%" ao lado de "55,7%" desalinha a coluna de numeros.
    expect(formatPercent(100)).toBe("100,0");
    expect(formatPercent(7, 2)).toBe("7,00");
  });

  it("arredonda, e nao corta", () => {
    expect(formatPercent(2.67)).toBe("2,7");
    expect(formatPercent(2.64)).toBe("2,6");
  });

  it("separa milhar, que aparece quando a base e pequena", () => {
    expect(formatPercent(1234.5)).toBe("1.234,5");
  });
});
