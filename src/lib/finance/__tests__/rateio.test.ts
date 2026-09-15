import { describe, expect, it } from "vitest";
import { emCentavos, restante, validarRateio, type ParteDoRateio } from "../rateio";

const parte = (valor: number, extras: Partial<ParteDoRateio> = {}): ParteDoRateio => ({
  valor,
  categoriaId: "cat",
  centroId: null,
  devedor: null,
  ...extras,
});

describe("validarRateio", () => {
  it("aceita a divisao que fecha com o total", () => {
    const r = validarRateio(-300, [parte(100), parte(200, { devedor: "Fulano" })]);
    expect(r.valido).toBe(true);
  });

  it("le o total pelo valor absoluto: a despesa chega negativa", () => {
    expect(validarRateio(-300, [parte(300)]).valido).toBe(true);
    expect(validarRateio(300, [parte(300)]).valido).toBe(true);
  });

  it("recusa quando falta dinheiro", () => {
    // Uma divisao que nao fecha some com dinheiro sem avisar, e o erro aparece
    // semanas depois como um total que ninguem explica.
    const r = validarRateio(-300, [parte(100), parte(150)]);
    expect(r.valido).toBe(false);
    if (!r.valido && r.erro.tipo === "nao-fecha") {
      expect(r.erro.diferenca).toBe(-50);
    }
  });

  it("recusa quando sobra dinheiro", () => {
    const r = validarRateio(-300, [parte(200), parte(200)]);
    expect(r.valido).toBe(false);
    if (!r.valido && r.erro.tipo === "nao-fecha") {
      expect(r.erro.diferenca).toBe(100);
    }
  });

  it("tolera um centavo, que e o que a divisao por tres produz", () => {
    // 33,33 tres vezes da 99,99. Recusar obrigaria a cacar um centavo.
    expect(validarRateio(-100, [parte(33.33), parte(33.33), parte(33.34)]).valido).toBe(true);
    expect(validarRateio(-100, [parte(33.33), parte(33.33), parte(33.33)]).valido).toBe(true);
  });

  it("nao tolera dois centavos", () => {
    expect(validarRateio(-100, [parte(49.99), parte(49.99)]).valido).toBe(false);
  });

  it("descarta parte zerada em vez de recusar a divisao", () => {
    // Campo vazio na tela vira zero; trata-lo como parte faria a divisao
    // falhar por causa de um campo que a pessoa nem usou.
    const r = validarRateio(-300, [parte(300), parte(0)]);
    expect(r.valido).toBe(true);
    if (r.valido) expect(r.partes).toHaveLength(1);
  });

  it("recusa divisao sem nenhuma parte com valor", () => {
    expect(validarRateio(-300, []).valido).toBe(false);
    expect(validarRateio(-300, [parte(0)]).valido).toBe(false);
  });

  it("recusa valor negativo: o sinal ja esta na cobranca", () => {
    const r = validarRateio(-300, [parte(400), parte(-100)]);
    expect(r.valido).toBe(false);
  });

  it("arredonda para centavos antes de somar", () => {
    // 0.1 + 0.2 em ponto flutuante nao da 0.3. Sem arredondar, uma divisao
    // correta seria recusada por um erro de representacao.
    const r = validarRateio(-0.3, [parte(0.1), parte(0.2)]);
    expect(r.valido).toBe(true);
  });
});

describe("restante", () => {
  it("devolve o que falta para fechar", () => {
    expect(restante(-300, 100)).toBe(200);
  });

  it("nunca e negativo: informar mais que o total nao gera troco", () => {
    expect(restante(-300, 400)).toBe(0);
  });

  it("sem nada informado, sobra o total", () => {
    expect(restante(-300, 0)).toBe(300);
  });
});

describe("emCentavos", () => {
  it("corta o lixo de ponto flutuante", () => {
    expect(emCentavos(0.1 + 0.2)).toBe(0.3);
    expect(emCentavos(1.005)).toBe(1.01);
  });
});
