import { describe, expect, it } from "vitest";
import { extractDetails } from "../details";

const MEU_CPF = { type: "CPF", value: "136.557.127-07" };
const OUTRO_CPF = { type: "CPF", value: "987.654.321-00" };

function rotulos(detalhes: { label: string; value: string }[]): string[] {
  return detalhes.map((d) => `${d.label}=${d.value}`);
}

describe("extractDetails", () => {
  it("traduz o meio de pagamento", () => {
    const d = extractDetails({ amount: -100, paymentData: { paymentMethod: "PIX" } });
    expect(rotulos(d)).toContain("Meio=Pix");
  });

  it("preserva um metodo desconhecido em vez de descartar", () => {
    const d = extractDetails({ amount: -100, paymentData: { paymentMethod: "NOVIDADE" } });
    expect(rotulos(d)).toContain("Meio=NOVIDADE");
  });

  // A regra que justifica o modulo existir.
  it("numa saida, omite o documento do pagador, que e o proprio usuario", () => {
    const d = extractDetails({
      amount: -320,
      paymentData: {
        payer: { documentNumber: MEU_CPF, name: null },
        receiver: { documentNumber: OUTRO_CPF, name: "Joao" },
      },
    });
    expect(rotulos(d).join(" ")).not.toContain("136.557.127-07");
    expect(rotulos(d)).toContain("Recebedor · CPF=987.654.321-00");
  });

  it("numa entrada, omite o documento do recebedor, que e o proprio usuario", () => {
    const d = extractDetails({
      amount: 1500,
      paymentData: {
        payer: { documentNumber: OUTRO_CPF, name: "Cliente" },
        receiver: { documentNumber: MEU_CPF, name: null },
      },
    });
    expect(rotulos(d).join(" ")).not.toContain("136.557.127-07");
    expect(rotulos(d)).toContain("Pagador · CPF=987.654.321-00");
  });

  it("expoe agencia, conta e ISPB da contraparte", () => {
    const d = extractDetails({
      amount: -50,
      paymentData: {
        receiver: { accountNumber: "12345-6", branchNumber: "0001", routingNumberISPB: "00416968" },
      },
    });
    expect(rotulos(d)).toContain("Recebedor · Agencia/conta=0001 / 12345-6");
    expect(rotulos(d)).toContain("Recebedor · ISPB do banco=00416968");
  });

  it("expoe identificadores que costumam carregar numero de contrato", () => {
    const d = extractDetails({
      amount: -2100,
      operationTypeAdditionalInfo: "CONTRATO 000123456",
      paymentData: { referenceNumber: "CTR-778899" },
    });
    expect(rotulos(d)).toContain("Detalhe da operacao=CONTRATO 000123456");
    expect(rotulos(d)).toContain("Referencia=CTR-778899");
  });

  it("expoe dados do estabelecimento e do cartao", () => {
    const d = extractDetails({
      amount: -89.9,
      merchant: { name: "Padaria Central", cnpj: "12345678000199", category: "Bakery" },
      creditCardMetadata: { installmentNumber: 2, totalInstallments: 10 },
    });
    expect(rotulos(d)).toContain("Estabelecimento · name=Padaria Central");
    expect(rotulos(d)).toContain("Cartao · installmentNumber=2");
    expect(rotulos(d)).toContain("Cartao · totalInstallments=10");
  });

  it("mostra a descricao original apenas quando difere da exibida", () => {
    const igual = extractDetails({ amount: -10, description: "Compra", descriptionRaw: "Compra" });
    expect(rotulos(igual).join(" ")).not.toContain("Descricao original");

    const diferente = extractDetails({
      amount: -10,
      description: "Compra",
      descriptionRaw: "COMPRA CARTAO 1234",
    });
    expect(rotulos(diferente)).toContain("Descricao original=COMPRA CARTAO 1234");
  });

  it("devolve lista vazia quando nao ha o que mostrar", () => {
    expect(extractDetails({ amount: -10 })).toEqual([]);
  });
});
