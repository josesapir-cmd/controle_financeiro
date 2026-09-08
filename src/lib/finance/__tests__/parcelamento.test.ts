import { describe, expect, it } from "vitest";
import { chaveDaCompra, ehParcelado } from "../parcelamento";

const d = (label: string, value: string) => ({ label, value });

/** Uma parcela de uma compra de dez, no cartao 2797. */
function parcela(n: number, extras: { compra?: string; total?: number; cartao?: string } = {}) {
  return [
    d("Cartao · cardNumber", extras.cartao ?? "2797"),
    d("Cartao · purchaseDate", extras.compra ?? "2026-08-10T12:12:44.000Z"),
    d("Cartao · installmentNumber", String(n)),
    d("Cartao · totalInstallments", String(extras.total ?? 10)),
  ];
}

describe("chaveDaCompra", () => {
  it("todas as parcelas da mesma compra dao a mesma chave", () => {
    // E disto que a heranca depende: sem a chave igual, a parcela de 2027
    // continuaria pedindo classificacao propria.
    const primeira = chaveDaCompra(parcela(1), "MAGAZINE X");
    const decima = chaveDaCompra(parcela(10), "MAGAZINE X");

    expect(primeira).toBe(decima);
    expect(primeira).not.toBeNull();
  });

  it("compra a vista nao tem chave: nao ha o que herdar", () => {
    expect(chaveDaCompra(parcela(1, { total: 1 }), "PADARIA")).toBeNull();
    expect(chaveDaCompra([d("Cartao · cardNumber", "2797")], "PADARIA")).toBeNull();
    expect(chaveDaCompra(undefined, "PADARIA")).toBeNull();
  });

  it("sem a data da compra nao ha chave, mesmo parcelado", () => {
    // A data e o que identifica a compra. Sem ela, duas compras no mesmo
    // cartao com o mesmo prazo e nome pareceriam a mesma.
    const semData = [
      d("Cartao · cardNumber", "2797"),
      d("Cartao · totalInstallments", "10"),
    ];
    expect(chaveDaCompra(semData, "MAGAZINE X")).toBeNull();
  });

  it("separa compras com prazos diferentes no mesmo instante", () => {
    const a = chaveDaCompra(parcela(1, { total: 10 }), "LOJA");
    const b = chaveDaCompra(parcela(1, { total: 6 }), "LOJA");
    expect(a).not.toBe(b);
  });

  it("separa cartoes diferentes", () => {
    const meu = chaveDaCompra(parcela(1, { cartao: "8228" }), "LOJA");
    const doPai = chaveDaCompra(parcela(1, { cartao: "2797" }), "LOJA");
    expect(meu).not.toBe(doPai);
  });

  it("separa estabelecimentos diferentes", () => {
    expect(chaveDaCompra(parcela(1), "LOJA A")).not.toBe(chaveDaCompra(parcela(1), "LOJA B"));
  });

  it("separa compras em instantes diferentes", () => {
    const manha = chaveDaCompra(parcela(1, { compra: "2026-08-10T12:12:44.000Z" }), "LOJA");
    const tarde = chaveDaCompra(parcela(1, { compra: "2026-08-10T18:30:00.000Z" }), "LOJA");
    expect(manha).not.toBe(tarde);
  });

  it("ignora variacao de caixa e acento na descricao", () => {
    // O mesmo estabelecimento pode chegar escrito de dois jeitos entre faturas;
    // duas chaves fariam a heranca parar no meio do parcelamento.
    expect(chaveDaCompra(parcela(1), "Ótica São José")).toBe(
      chaveDaCompra(parcela(2), "OTICA SAO JOSE"),
    );
  });
});

describe("ehParcelado", () => {
  it("responde pela existencia da chave", () => {
    expect(ehParcelado(parcela(3), "LOJA")).toBe(true);
    expect(ehParcelado(parcela(1, { total: 1 }), "LOJA")).toBe(false);
    expect(ehParcelado([], "LOJA")).toBe(false);
  });
});
