import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import {
  casarPedidos,
  mesclarPedidos,
  nomeDaLoja,
  termosDaLoja,
  validarPedidos,
  type Cobranca,
  type Pedido,
} from "../pedidos";

// A identidade do produto lido e um HMAC, entao os testes precisam de chave.
beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  resetKeyCache();
});

const PROCEDENCIA = { envio: 1, arquivos: ["pedidos.png"] };

function bruto(patch: Record<string, unknown> = {}) {
  return {
    loja: "Amazon",
    produto: "Fone JBL Tune 510BT",
    data: "2026-08-20",
    valor: 199.9,
    confianca: "alta",
    ...patch,
  };
}

function cobranca(patch: Partial<Cobranca> = {}): Cobranca {
  return {
    id: "t1",
    dia: "2026-08-22",
    valor: -199.9,
    descricao: "AMAZON BR",
    ...patch,
  };
}

function pedido(patch: Partial<Pedido> = {}): Pedido {
  const { pedidos } = validarPedidos([bruto()], PROCEDENCIA);
  return { ...pedidos[0], ...patch };
}

describe("termosDaLoja", () => {
  it("conhece os nomes que a fatura usa, nao os que a loja usa", () => {
    // A Apple cobra como "APPLE.COM/BILL"; o Mercado Livre as vezes como
    // "MERCADOPAGO". Sem o mapa, o casamento nao acharia nada.
    expect(termosDaLoja("Apple")).toContain("itunes");
    expect(termosDaLoja("Mercado Livre")).toContain("mercadopago");
    expect(termosDaLoja("amazon.com.br")).toContain("amzn");
  });

  it("loja desconhecida vale pelo proprio nome", () => {
    expect(termosDaLoja("Livraria da Vila")).toEqual(["livraria da vila"]);
  });

  it("nome curto demais nao vira termo", () => {
    // "Oi" casaria com meia fatura.
    expect(termosDaLoja("Oi")).toEqual([]);
    expect(termosDaLoja("")).toEqual([]);
  });
});

describe("nomeDaLoja", () => {
  it("normaliza a loja conhecida e preserva a desconhecida", () => {
    expect(nomeDaLoja("amazon.com.br")).toBe("Amazon");
    expect(nomeDaLoja("MERCADOLIVRE")).toBe("Mercado Livre");
    expect(nomeDaLoja("Livraria da Vila")).toBe("Livraria da Vila");
  });
});

describe("validarPedidos", () => {
  it("aceita o pedido completo", () => {
    const { pedidos, rejeitados } = validarPedidos([bruto()], PROCEDENCIA);
    expect(rejeitados).toEqual([]);
    expect(pedidos[0]).toMatchObject({
      loja: "Amazon",
      produto: "Fone JBL Tune 510BT",
      dia: "2026-08-20",
      valor: 199.9,
      confianca: "alta",
      envio: 1,
    });
  });

  it("recusa pedido sem loja", () => {
    // Sem loja o casamento viraria so valor e data, e casaria o livro da
    // Amazon com o almoco de mesmo preco.
    const { pedidos, rejeitados } = validarPedidos([bruto({ loja: "  " })], PROCEDENCIA);
    expect(pedidos).toEqual([]);
    expect(rejeitados[0].motivo).toBe("Sem loja");
  });

  it("recusa data, produto e valor ilegiveis", () => {
    const { rejeitados } = validarPedidos(
      [bruto({ data: "20/08" }), bruto({ produto: "" }), bruto({ valor: 0 })],
      PROCEDENCIA,
    );
    expect(rejeitados.map((r) => r.motivo)).toEqual([
      "Data ilegivel",
      "Sem nome de produto",
      "Valor ilegivel",
    ]);
  });

  it("dois itens iguais no mesmo pedido sao duas linhas", () => {
    const { pedidos } = validarPedidos([bruto(), bruto()], PROCEDENCIA);
    expect(pedidos).toHaveLength(2);
    expect(pedidos[0].id).not.toBe(pedidos[1].id);
  });

  it("o mesmo produto lido de novo tem a mesma identidade", () => {
    const a = validarPedidos([bruto()], PROCEDENCIA).pedidos[0];
    const b = validarPedidos([bruto()], { envio: 2, arquivos: ["outro.png"] }).pedidos[0];
    expect(a.id).toBe(b.id);
  });
});

describe("casarPedidos", () => {
  it("casa quando valor, janela e loja batem", () => {
    const [casamento] = casarPedidos([pedido()], [cobranca()]);
    expect(casamento.certeza).toBe("exata");
    expect(casamento.cobrancaId).toBe("t1");
  });

  it("nao casa cobranca de outra loja com o mesmo valor", () => {
    const [casamento] = casarPedidos([pedido()], [cobranca({ descricao: "RESTAURANTE X" })]);
    expect(casamento.certeza).toBe("sem");
    expect(casamento.cobrancaId).toBeNull();
  });

  it("nao casa valor diferente, nem por um centavo", () => {
    const [casamento] = casarPedidos([pedido()], [cobranca({ valor: -199.91 })]);
    expect(casamento.certeza).toBe("sem");
  });

  it("nao casa entrada", () => {
    // Estorno da Amazon de mesmo valor nao e a compra.
    const [casamento] = casarPedidos([pedido()], [cobranca({ valor: 199.9 })]);
    expect(casamento.certeza).toBe("sem");
  });

  it("aceita a cobranca dias depois do pedido, que e o normal", () => {
    const [casamento] = casarPedidos([pedido()], [cobranca({ dia: "2026-08-28" })]);
    expect(casamento.certeza).toBe("exata");
  });

  it("recusa cobranca fora da janela", () => {
    expect(casarPedidos([pedido()], [cobranca({ dia: "2026-09-05" })])[0].certeza).toBe("sem");
    expect(casarPedidos([pedido()], [cobranca({ dia: "2026-08-10" })])[0].certeza).toBe("sem");
  });

  it("duas cobrancas iguais na janela viram duvida, nao chute", () => {
    const [casamento] = casarPedidos(
      [pedido()],
      [cobranca(), cobranca({ id: "t2", dia: "2026-08-23" })],
    );
    expect(casamento.certeza).toBe("ambigua");
    expect(casamento.cobrancaId).toBeNull();
    expect(casamento.candidatas.map((c) => c.id)).toEqual(["t1", "t2"]);
  });

  it("uma cobranca nao recebe dois produtos", () => {
    // Duas compras de mesmo valor na semana existem; deixar as duas apontarem
    // para a mesma cobranca criaria uma associacao falsa em silencio.
    const um = pedido();
    const dois = { ...pedido(), id: "outro", dia: "2026-08-19", produto: "Cabo USB" };
    const casamentos = casarPedidos([um, dois], [cobranca()]);

    const comCobranca = casamentos.filter((c) => c.cobrancaId === "t1");
    expect(comCobranca).toHaveLength(1);
    // O mais proximo em dias fica com ela; o outro sai sem.
    expect(comCobranca[0].pedido.id).toBe(um.id);
    expect(casamentos.find((c) => c.pedido.id === "outro")?.certeza).toBe("sem");
  });

  it("reconhece a Apple pelo nome que aparece na fatura", () => {
    const assinatura = {
      ...pedido(),
      loja: "Apple",
      produto: "iCloud+ 200GB",
      valor: 10.9,
      dia: "2026-08-20",
    };
    const [casamento] = casarPedidos(
      [assinatura],
      [cobranca({ id: "t9", descricao: "APPLE.COM/BILL", valor: -10.9, dia: "2026-08-20" })],
    );
    expect(casamento.certeza).toBe("exata");
    expect(casamento.cobrancaId).toBe("t9");
  });

  it("olha tambem a contraparte, nao so a descricao", () => {
    const [casamento] = casarPedidos(
      [pedido()],
      [cobranca({ descricao: "COMPRA CARTAO", contraparte: "AMAZON SERVICOS DE VAREJO" })],
    );
    expect(casamento.certeza).toBe("exata");
  });

  it("sem cobranca nenhuma, todos saem sem casamento", () => {
    const [casamento] = casarPedidos([pedido()], []);
    expect(casamento).toMatchObject({ certeza: "sem", cobrancaId: null, candidatas: [] });
  });
});

describe("mesclarPedidos", () => {
  it("nao repete o produto que ja veio noutro envio", () => {
    const a = validarPedidos([bruto()], PROCEDENCIA).pedidos;
    const b = validarPedidos([bruto()], { envio: 2, arquivos: ["b.png"] }).pedidos;
    expect(mesclarPedidos(a, b)).toHaveLength(1);
    // O primeiro envio manda: e dele o registro de qual arquivo trouxe a linha.
    expect(mesclarPedidos(a, b)[0].envio).toBe(1);
  });

  it("soma produtos diferentes", () => {
    const a = validarPedidos([bruto()], PROCEDENCIA).pedidos;
    const b = validarPedidos([bruto({ produto: "Cabo USB", valor: 39.9 })], PROCEDENCIA).pedidos;
    expect(mesclarPedidos(a, b)).toHaveLength(2);
  });
});
