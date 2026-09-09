import { describe, expect, it } from "vitest";
import { pedidosPlausiveis, type PedidoLido } from "../pedido-do-print";

const pedido = (extras: Partial<PedidoLido> = {}): PedidoLido => ({
  loja: "Mercado Livre",
  produto: "Fone bluetooth",
  dia: "2026-08-01",
  valor: 519.8,
  referencia: null,
  ...extras,
});

const despesa = (extras: Partial<Parameters<typeof pedidosPlausiveis>[0]> = {}) => ({
  dia: "2026-08-06",
  valor: -519.8,
  descricao: "MERCADOLIVRE*ELECTROL",
  contraparte: null,
  ...extras,
});

describe("pedidosPlausiveis", () => {
  it("acha o pedido da mesma loja, mesmo valor, poucos dias antes", () => {
    // A cobranca cai no envio, dias depois do pedido: e o caso normal.
    expect(pedidosPlausiveis(despesa(), [pedido()])).toHaveLength(1);
  });

  it("recusa valor diferente", () => {
    expect(pedidosPlausiveis(despesa(), [pedido({ valor: 519.9 })])).toHaveLength(0);
  });

  it("aceita centavos de arredondamento, que a leitura de imagem produz", () => {
    expect(pedidosPlausiveis(despesa(), [pedido({ valor: 519.8004 })])).toHaveLength(1);
  });

  it("recusa pedido fora da janela de dias", () => {
    // Muito antes: a cobranca demorar um mes nao e o caso comum, e casar assim
    // grudaria produto errado em compra de valor repetido.
    expect(pedidosPlausiveis(despesa(), [pedido({ dia: "2026-06-01" })])).toHaveLength(0);
    // Depois da cobranca: pedido feito depois nao pode ter gerado ela.
    expect(pedidosPlausiveis(despesa(), [pedido({ dia: "2026-08-20" })])).toHaveLength(0);
  });

  it("tolera a cobranca um pouco antes, para dia lido errado na virada", () => {
    expect(pedidosPlausiveis(despesa({ dia: "2026-07-31" }), [pedido()])).toHaveLength(1);
  });

  it("recusa loja que nao aparece na descricao", () => {
    expect(
      pedidosPlausiveis(despesa({ descricao: "POSTO IPIRANGA" }), [pedido()]),
    ).toHaveLength(0);
  });

  it("acha a loja pela contraparte quando a descricao nao diz", () => {
    expect(
      pedidosPlausiveis(
        despesa({ descricao: "COMPRA CARTAO", contraparte: "Mercado Livre" }),
        [pedido()],
      ),
    ).toHaveLength(1);
  });

  it("entrada nunca casa com pedido", () => {
    // Estorno tem o mesmo valor da compra e cairia na janela. Um produto
    // grudado num credito seria informacao invertida.
    expect(pedidosPlausiveis(despesa({ valor: 519.8 }), [pedido()])).toHaveLength(0);
  });

  it("devolve os dois quando ha dois candidatos, do mais proximo ao mais distante", () => {
    // Escolher um seria decidir a ambiguidade que a tela de conferencia existe
    // para resolver. Ver os dois e a propria informacao.
    const perto = pedido({ produto: "Fone", dia: "2026-08-05" });
    const longe = pedido({ produto: "Cabo", dia: "2026-07-30" });

    const achados = pedidosPlausiveis(despesa(), [longe, perto]);
    expect(achados.map((p) => p.produto)).toEqual(["Fone", "Cabo"]);
  });

  it("sem pedidos, sem palpite", () => {
    expect(pedidosPlausiveis(despesa(), [])).toEqual([]);
  });
});
