import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/pluggy/types";
import { meioDePagamento, rotuloContemNome, rotuloDoLancamento } from "../rotulo";

function transacao(patch: Partial<Transaction> = {}): Transaction {
  return {
    id: "t1",
    accountId: "a1",
    description: "Lancamento",
    amount: -100,
    currencyCode: "BRL",
    date: "2026-09-01T12:00:00.000Z",
    ...patch,
  };
}

describe("meioDePagamento", () => {
  it("le o detalhe Meio, que vem do paymentMethod da Pluggy", () => {
    expect(meioDePagamento(transacao({ details: [{ label: "Meio", value: "Pix" }] }))).toBe("PIX");
  });

  it("nao inventa rotulo para meio que a Pluggy conhece e nos nao", () => {
    // "Cartao de credito" e um meio legitimo, so nao tem forma curta util aqui.
    const t = transacao({ details: [{ label: "Meio", value: "Cartao de credito" }] });
    expect(meioDePagamento(t)).toBeNull();
  });

  it("cai na categoria quando nao ha detalhe", () => {
    expect(meioDePagamento(transacao({ category: "Transfer - PIX" }))).toBe("PIX");
  });

  it("cai na descricao por ultimo", () => {
    expect(meioDePagamento(transacao({ description: "Pix enviado" }))).toBe("PIX");
    expect(meioDePagamento(transacao({ description: "TED enviada" }))).toBe("TED");
  });

  it("o detalhe vence a descricao", () => {
    // Uma compra no debito para pagar algo com "pix" no nome nao vira Pix.
    const t = transacao({
      description: "Compra no debito - PIX LANCHES",
      details: [{ label: "Meio", value: "Cartao de debito" }],
    });
    expect(meioDePagamento(t)).toBeNull();
  });

  it("exige a palavra inteira na descricao", () => {
    expect(meioDePagamento(transacao({ description: "Pagamento Pixel Studio" }))).toBeNull();
  });

  it("devolve null quando nao da para afirmar", () => {
    expect(meioDePagamento(transacao({ description: "Compra no cartao" }))).toBeNull();
  });
});

describe("rotuloDoLancamento", () => {
  const pix = { details: [{ label: "Meio", value: "Pix" }] };

  it("saida vira PIX para", () => {
    expect(rotuloDoLancamento(transacao({ ...pix, amount: -320 }), "Joao Diarista")).toBe(
      "PIX para Joao Diarista",
    );
  });

  it("entrada vira PIX de", () => {
    expect(rotuloDoLancamento(transacao({ ...pix, amount: 1500 }), "Cliente Alfa")).toBe(
      "PIX de Cliente Alfa",
    );
  });

  it("usa o apelido que o chamador passar", () => {
    expect(rotuloDoLancamento(transacao(pix), "Mae")).toBe("PIX para Mae");
  });

  it("sem contraparte, a descricao do extrato passa intacta", () => {
    const t = transacao({ ...pix, description: "Transferencia enviada pelo Pix" });
    expect(rotuloDoLancamento(t, null)).toBe("Transferencia enviada pelo Pix");
    expect(rotuloDoLancamento(t, "   ")).toBe("Transferencia enviada pelo Pix");
  });

  it("sem meio reconhecido, a descricao do extrato passa intacta", () => {
    const t = transacao({ description: "Compra no cartao - Mercado" });
    expect(rotuloDoLancamento(t, "Mercado Central")).toBe("Compra no cartao - Mercado");
  });

  it("descricao vazia nao vira rotulo vazio", () => {
    expect(rotuloDoLancamento(transacao({ description: "" }), null)).toBe("Lancamento");
  });

  it("serve TED e boleto tambem", () => {
    const ted = transacao({ details: [{ label: "Meio", value: "TED" }] });
    expect(rotuloDoLancamento(ted, "Fulano")).toBe("TED para Fulano");
  });
});

describe("rotuloContemNome", () => {
  it("reconhece o nome ja presente no rotulo", () => {
    expect(rotuloContemNome("PIX para Joao Diarista", "Joao Diarista")).toBe(true);
  });

  it("ignora acento e caixa, porque o extrato vem em caixa alta", () => {
    expect(rotuloContemNome("PIX para Mae", "MÃE")).toBe(true);
  });

  it("nao esconde um nome que nao esta la", () => {
    expect(rotuloContemNome("Compra no cartao", "Mercado Central")).toBe(false);
    expect(rotuloContemNome("PIX para Fulano", null)).toBe(false);
  });
});
