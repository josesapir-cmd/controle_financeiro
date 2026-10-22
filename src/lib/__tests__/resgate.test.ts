import { describe, expect, it } from "vitest";
import {
  aliquotaDeIof,
  aliquotaDeIr,
  economiaEsperando,
  lotesEmAberto,
  planoCombinado,
  proximoDegrau,
  simularVenda,
  type Lote,
} from "../resgate.mjs";

const compra = (date: string, quantity: number, value: number) => ({
  type: "BUY",
  date,
  quantity,
  value,
  amount: quantity * value,
});
const venda = (date: string, quantity: number, value: number) => ({
  type: "SELL",
  date,
  quantity,
  value,
  amount: quantity * value,
});

describe("tabela regressiva", () => {
  it("muda no dia seguinte ao limite de cada faixa", () => {
    expect(aliquotaDeIr(180)).toBe(0.225);
    expect(aliquotaDeIr(181)).toBe(0.2);
    expect(aliquotaDeIr(360)).toBe(0.2);
    expect(aliquotaDeIr(361)).toBe(0.175);
    expect(aliquotaDeIr(720)).toBe(0.175);
    expect(aliquotaDeIr(721)).toBe(0.15);
    expect(aliquotaDeIr(5000)).toBe(0.15);
  });

  it("IOF some a partir do trigesimo dia", () => {
    expect(aliquotaDeIof(1)).toBe(0.96);
    expect(aliquotaDeIof(29)).toBe(0.03);
    expect(aliquotaDeIof(30)).toBe(0);
  });

  it("diz quando o lote cai de faixa, e nada na de 15%", () => {
    // 2025-01-01 + 721 dias = 2026-12-23
    expect(proximoDegrau("2025-01-01", "2026-10-22")).toEqual({
      dia: "2026-12-23",
      aliquota: 0.15,
    });
    expect(proximoDegrau("2020-01-01", "2026-10-22")).toBeNull();
  });
});

describe("lotes em aberto", () => {
  it("vendas passadas consomem os lotes mais antigos primeiro", () => {
    const { lotes, sobra } = lotesEmAberto([
      compra("2023-03-01", 10, 1000),
      compra("2024-03-01", 10, 1200),
      venda("2024-06-01", 12, 1300),
    ]);

    // O primeiro lote saiu inteiro, o segundo perdeu 2.
    expect(lotes).toHaveLength(1);
    expect(lotes[0].compradoEm).toBe("2024-03-01");
    expect(lotes[0].quantidade).toBe(8);
    expect(lotes[0].original).toBe(10);
    expect(sobra).toBe(0);
  });

  it("ordena por data mesmo quando a instituicao manda fora de ordem", () => {
    const { lotes } = lotesEmAberto([
      compra("2024-03-01", 5, 1200),
      venda("2024-06-01", 3, 1300),
      compra("2023-03-01", 5, 1000),
    ]);
    expect(lotes.map((l) => [l.compradoEm, l.quantidade])).toEqual([
      ["2023-03-01", 2],
      ["2024-03-01", 5],
    ]);
  });

  it("conta a venda alem do comprado, que denuncia historico incompleto", () => {
    const { lotes, sobra } = lotesEmAberto([compra("2024-03-01", 5, 1000), venda("2024-06-01", 8, 1100)]);
    expect(lotes).toHaveLength(0);
    expect(sobra).toBe(3);
  });

  it("transferencia de custodia entra marcada, porque a data nao e a da compra", () => {
    const { lotes } = lotesEmAberto([
      { type: "TRANSFER", movementType: "CREDIT", date: "2024-05-10", quantity: 4, value: 900 },
    ]);
    expect(lotes[0].origem).toBe("transferencia");
  });

  it("deduz a quantidade do valor quando a instituicao nao manda", () => {
    const { lotes } = lotesEmAberto([{ type: "BUY", date: "2024-01-02", value: 1000, amount: 2500 }]);
    expect(lotes[0].quantidade).toBe(2.5);
  });

  it("ignora o que nao e compra, venda nem transferencia", () => {
    const { lotes, ignorados } = lotesEmAberto([
      compra("2024-01-02", 1, 1000),
      { type: "INTEREST", date: "2024-02-01", amount: 10 },
    ]);
    expect(lotes).toHaveLength(1);
    expect(ignorados).toBe(1);
  });
});

const lote = (compradoEm: string, quantidade: number, precoUnitario: number): Lote => ({
  compradoEm,
  quantidade,
  original: quantidade,
  precoUnitario,
  origem: "compra",
  id: null,
});

describe("simulacao da venda", () => {
  const lotes = [
    lote("2024-03-01", 100, 1000), // 965 dias em 2026-10-22: 15%
    lote("2025-06-01", 100, 1100), // 508 dias: 17,5%
    lote("2026-10-10", 100, 1250), // 12 dias: IOF
  ];

  it("consome do mais antigo para o mais novo", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 150 * 1300 });
    expect(s.quantidade).toBe(150);
    expect(s.pedacos.map((p) => [p.compradoEm, p.quantidadeVendida])).toEqual([
      ["2024-03-01", 100],
      ["2025-06-01", 50],
    ]);
  });

  it("calcula IR lote a lote, cada um na sua faixa", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 150 * 1300 });
    // 100 x 300 x 15% + 50 x 200 x 17,5%
    expect(s.pedacos[0].ir).toBeCloseTo(4500, 6);
    expect(s.pedacos[1].ir).toBeCloseTo(1750, 6);
    expect(s.ir).toBeCloseTo(6250, 6);
    expect(s.liquido).toBeCloseTo(195000 - 6250, 6);
  });

  it("arredonda a quantidade para cima no centesimo, para nao entregar menos", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 1000 });
    // 1000 / 1300 = 0,769... -> 0,77
    expect(s.quantidade).toBe(0.77);
    expect(s.bruto).toBeGreaterThanOrEqual(1000);
  });

  it("cobra IOF antes do IR quando a venda chega na compra do mes", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 300 * 1300 });
    const recente = s.pedacos[2];
    expect(recente.dias).toBe(12);
    expect(recente.aliqIof).toBe(0.6);
    // ganho 100 x 50 = 5000; IOF 3000; IR 22,5% de 2000
    expect(recente.iof).toBeCloseTo(3000, 6);
    expect(recente.ir).toBeCloseTo(450, 6);
  });

  it("acha a quantidade que entrega o liquido pedido", () => {
    const s = simularVenda(lotes, {
      preco: 1300,
      em: "2026-10-22",
      alvo: 150000,
      modo: "liquido",
    });
    expect(s.liquido).toBeGreaterThanOrEqual(150000);
    // Um centesimo a menos ja nao alcancaria.
    expect(s.liquido - (1300 - 300 * 0.15) * 0.01).toBeLessThan(150000);
  });

  it("avisa quando a carteira nao tem o bastante", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 10_000_000 });
    expect(s.insuficiente).toBe(true);
    expect(s.quantidade).toBe(300);
  });

  it("lote no prejuizo nao paga e nao gera imposto negativo", () => {
    const s = simularVenda([lote("2024-01-01", 10, 1500)], {
      preco: 1300,
      em: "2026-10-22",
      alvo: 13000,
    });
    expect(s.ir).toBe(0);
    expect(s.prejuizo).toBeCloseTo(-2000, 6);
  });

  it("mostra quanto cada lote economiza esperando o degrau", () => {
    const s = simularVenda(lotes, { preco: 1300, em: "2026-10-22", alvo: 150 * 1300 });
    const [e] = economiaEsperando(s);
    // 2025-06-01 + 721 = 2027-05-23; 50 x 200 x 2,5 p.p.
    expect(e.dia).toBe("2027-05-23");
    expect(e.economia).toBeCloseTo(250, 6);
  });
});

describe("plano combinado entre filas", () => {
  const em = "2026-10-22";
  // Fila A: lote velho com muito ganho a 15%. Fila B: lote recente quase sem ganho.
  const a = { chave: "A", preco: 1300, lotes: [lote("2023-01-10", 100, 800)] };
  const b = { chave: "B", preco: 1300, lotes: [lote("2026-05-01", 100, 1290)] };

  it("comeca pela fila que paga menos imposto por real vendido", () => {
    const plano = planoCombinado([a, b], { em, alvo: 50 * 1300 });
    expect(plano.ordens.map((o) => o.chave)).toEqual(["B"]);
    expect(plano.ordens[0].simulacao.quantidade).toBe(50);
  });

  it("passa para a outra fila quando a primeira acaba", () => {
    const plano = planoCombinado([a, b], { em, alvo: 150 * 1300 });
    const porFila = Object.fromEntries(plano.ordens.map((o) => [o.chave, o.simulacao.quantidade]));
    expect(porFila).toEqual({ B: 100, A: 50 });
    expect(plano.bruto).toBeCloseTo(150 * 1300, 6);
    // B tem 174 dias, 22,5%: 100 x 10 x 22,5%. A: 50 x 500 x 15%.
    expect(plano.ir).toBeCloseTo(225 + 3750, 6);
  });

  it("nunca pula o lote da frente de uma fila", () => {
    // Na fila C o lote da frente e caro e o seguinte e barato: o barato so sai
    // depois do caro, porque PEPS nao deixa escolher o do meio.
    const c = {
      chave: "C",
      preco: 1300,
      lotes: [lote("2023-01-10", 10, 500), lote("2026-05-01", 100, 1300)],
    };
    const plano = planoCombinado([c], { em, alvo: 20 * 1300 });
    const pedacos = plano.ordens[0].simulacao.pedacos;
    expect(pedacos[0].compradoEm).toBe("2023-01-10");
    expect(pedacos[0].quantidadeVendida).toBe(10);
  });

  it("avisa quando nem somando tudo cobre", () => {
    const plano = planoCombinado([a, b], { em, alvo: 10_000_000 });
    expect(plano.insuficiente).toBe(true);
    expect(plano.bruto).toBeCloseTo(200 * 1300, 6);
  });
});
