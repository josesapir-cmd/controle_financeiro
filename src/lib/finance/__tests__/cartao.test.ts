import { describe, expect, it } from "vitest";
import { dadosDoCartao, rotuloDaParcela } from "../cartao";

const detalhe = (label: string, value: string) => ({ label, value });

describe("dadosDoCartao", () => {
  it("le os campos do bloco do cartao", () => {
    const dados = dadosDoCartao([
      detalhe("Meio de pagamento", "Cartao de credito"),
      detalhe("Cartao · cardNumber", "2797"),
      detalhe("Cartao · payeeMCC", "5411"),
      detalhe("Cartao · installmentNumber", "3"),
      detalhe("Cartao · totalInstallments", "10"),
    ]);

    expect(dados).toEqual({ numero: "2797", mcc: "5411", parcela: 3, totalDeParcelas: 10 });
  });

  it("devolve tudo nulo quando o lancamento nao e de cartao", () => {
    expect(dadosDoCartao([detalhe("Meio de pagamento", "PIX")])).toEqual({
      numero: null,
      mcc: null,
      parcela: null,
      totalDeParcelas: null,
    });
  });

  it("nao estoura sem detalhes", () => {
    expect(dadosDoCartao(undefined).numero).toBeNull();
    expect(dadosDoCartao([]).numero).toBeNull();
  });

  it("ignora valor vazio, que nao e o mesmo que valor ausente", () => {
    expect(dadosDoCartao([detalhe("Cartao · cardNumber", "   ")]).numero).toBeNull();
  });

  it("recusa parcela que nao e inteiro positivo, em vez de propagar NaN", () => {
    const dados = dadosDoCartao([
      detalhe("Cartao · installmentNumber", "abc"),
      detalhe("Cartao · totalInstallments", "0"),
    ]);

    expect(dados.parcela).toBeNull();
    expect(dados.totalDeParcelas).toBeNull();
  });

  it("nao confunde um rotulo que apenas comeca parecido", () => {
    expect(dadosDoCartao([detalhe("Cartao · cardNumberOld", "1111")]).numero).toBeNull();
  });
});

describe("rotuloDaParcela", () => {
  it("escreve a parcela quando ha parcelamento", () => {
    expect(rotuloDaParcela({ numero: null, mcc: null, parcela: 3, totalDeParcelas: 10 })).toBe(
      "3/10",
    );
  });

  it("compra a vista nao vira 1/1 na tela", () => {
    // O banco marca 1 de 1 em compra a vista. Escrever isso seria ruido em
    // quase todo lancamento do cartao.
    expect(rotuloDaParcela({ numero: null, mcc: null, parcela: 1, totalDeParcelas: 1 })).toBeNull();
  });

  it("sem parcelamento nao ha rotulo", () => {
    expect(
      rotuloDaParcela({ numero: null, mcc: null, parcela: null, totalDeParcelas: null }),
    ).toBeNull();
  });
});
