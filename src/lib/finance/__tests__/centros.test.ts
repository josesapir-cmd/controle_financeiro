import { describe, expect, it } from "vitest";
import type { CounterpartyTotal } from "../counterparties";
import { cruzarCentrosDeCusto, totalPorTipo, type Categoria, type CentroDeCusto } from "../centros";

const VIAGEM: Categoria = { id: "cat-viagem", name: "Viagem", kind: "despesa", position: 10, hue: 30, hint: null };
const FAMILIA: Categoria = { id: "cat-familia", name: "Familia", kind: "despesa", position: 20, hue: 145, hint: null };

function centro(id: string, categoryId: string, name: string, extra: Partial<CentroDeCusto> = {}): CentroDeCusto {
  return { id, categoryId, name, note: null, startsOn: null, endsOn: null, budget: null, ...extra };
}

function contraparte(over: Partial<CounterpartyTotal> = {}): CounterpartyTotal {
  return {
    key: over.key ?? "k",
    name: "Contraparte",
    sent: 100,
    received: 0,
    net: -100,
    count: 1,
    lastDate: "2026-05-12T12:00:00.000Z",
    self: false,
    transactions: [],
    ...over,
  };
}

describe("cruzarCentrosDeCusto", () => {
  it("soma a contraparte no centro de custo pelo nome da subcategoria", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [VIAGEM],
      [centro("c1", "cat-viagem", "Viagem FDS Familia")],
      [contraparte({ category: "Viagem", subcategory: "Viagem FDS Familia", sent: 4280 })],
    );

    expect(categorias[0].sent).toBe(4280);
    expect(categorias[0].centros[0].sent).toBe(4280);
    expect(categorias[0].centros[0].counterparties).toBe(1);
  });

  it("separa varias pessoas dentro da mesma categoria", () => {
    // O caso pedido: dentro de Familia, quanto vai para cada um.
    const { categorias } = cruzarCentrosDeCusto(
      [FAMILIA],
      [
        centro("pai", "cat-familia", "Pai"),
        centro("mae", "cat-familia", "Mae"),
        centro("irma", "cat-familia", "Irma"),
      ],
      [
        contraparte({ key: "a", category: "Familia", subcategory: "Pai", sent: 3000 }),
        contraparte({ key: "b", category: "Familia", subcategory: "Mae", sent: 2000 }),
        contraparte({ key: "c", category: "Familia", subcategory: "Pai", sent: 500 }),
      ],
    );

    const porNome = Object.fromEntries(categorias[0].centros.map((c) => [c.name, c.sent]));
    expect(porNome).toEqual({ Pai: 3500, Mae: 2000, Irma: 0 });
    expect(categorias[0].sent).toBe(5500);
  });

  // Um centro criado para a viagem do mes que vem precisa existir na tela antes
  // do primeiro gasto; orcamento que so aparece depois nao serve para planejar.
  it("mostra zerado o centro sem movimento, em vez de esconder", () => {
    const { categorias } = cruzarCentrosDeCusto([VIAGEM], [centro("c1", "cat-viagem", "Bariloche")], []);

    expect(categorias[0].centros).toHaveLength(1);
    expect(categorias[0].centros[0].sent).toBe(0);
  });

  it("mostra zerada a categoria sem movimento", () => {
    const { categorias } = cruzarCentrosDeCusto([VIAGEM, FAMILIA], [], []);

    expect(categorias.map((c) => c.name)).toEqual(["Viagem", "Familia"]);
  });

  it("poe em 'sem centro' o que tem categoria mas nao subcategoria", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [VIAGEM],
      [centro("c1", "cat-viagem", "Bariloche")],
      [contraparte({ category: "Viagem", sent: 900 })],
    );

    expect(categorias[0].semCentro.sent).toBe(900);
    expect(categorias[0].centros[0].sent).toBe(0);
    expect(categorias[0].sent).toBe(900);
  });

  it("junta em 'sem categoria' o que ainda nao foi classificado", () => {
    const { semCategoria } = cruzarCentrosDeCusto(
      [VIAGEM],
      [],
      [contraparte({ sent: 700 }), contraparte({ key: "b", category: "Inexistente", sent: 300 })],
    );

    expect(semCategoria.sent).toBe(1000);
    expect(semCategoria.counterparties).toBe(2);
  });

  it("ignora acento e caixa ao casar os rotulos", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [{ ...FAMILIA, name: "Família" }],
      [centro("mae", "cat-familia", "Mãe")],
      [contraparte({ category: "familia", subcategory: "MAE", sent: 250 })],
    );

    expect(categorias[0].centros[0].sent).toBe(250);
  });

  it("nao conta transferencia entre contas proprias", () => {
    const { categorias, semCategoria } = cruzarCentrosDeCusto(
      [VIAGEM],
      [],
      [contraparte({ self: true, sent: 50000 })],
    );

    expect(categorias[0].sent).toBe(0);
    expect(semCategoria.sent).toBe(0);
  });

  it("calcula a fracao do orcamento consumida", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [VIAGEM],
      [centro("c1", "cat-viagem", "Bariloche", { budget: 10000 })],
      [contraparte({ category: "Viagem", subcategory: "Bariloche", sent: 2500 })],
    );

    expect(categorias[0].centros[0].budgetUsed).toBeCloseTo(0.25);
  });

  it("nao inventa fracao quando nao ha orcamento", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [VIAGEM],
      [centro("c1", "cat-viagem", "Bariloche")],
      [contraparte({ category: "Viagem", subcategory: "Bariloche", sent: 2500 })],
    );

    expect(categorias[0].centros[0].budgetUsed).toBeUndefined();
  });

  it("ordena centros por movimento, e os zerados em ordem alfabetica", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [FAMILIA],
      [
        centro("z", "cat-familia", "Zeca"),
        centro("a", "cat-familia", "Ana"),
        centro("p", "cat-familia", "Pai"),
      ],
      [contraparte({ category: "Familia", subcategory: "Pai", sent: 100 })],
    );

    expect(categorias[0].centros.map((c) => c.name)).toEqual(["Pai", "Ana", "Zeca"]);
  });

  it("respeita a posicao ao ordenar categorias", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [{ ...FAMILIA, position: 5 }, VIAGEM],
      [],
      [],
    );

    expect(categorias.map((c) => c.name)).toEqual(["Familia", "Viagem"]);
  });
});

describe("totalPorTipo", () => {
  it("soma so as categorias do tipo pedido", () => {
    const { categorias } = cruzarCentrosDeCusto(
      [VIAGEM, { id: "r", name: "Renda", kind: "receita", position: 1, hue: 150, hint: null }],
      [],
      [
        contraparte({ category: "Viagem", sent: 400 }),
        contraparte({ key: "b", category: "Renda", sent: 0, received: 9000 }),
      ],
    );

    expect(totalPorTipo(categorias, "despesa").sent).toBe(400);
    expect(totalPorTipo(categorias, "receita").received).toBe(9000);
  });
});

describe("rotulo do lancamento vence o da contraparte", () => {
  const AMAZON = contraparte({
    key: "amazon",
    category: "Familia",
    subcategory: "Pai",
    sent: 300,
    count: 3,
    transactions: [
      { id: "t1", date: "2026-05-01T12:00:00Z", description: "a", amount: -100 },
      { id: "t2", date: "2026-05-02T12:00:00Z", description: "b", amount: -100 },
      { id: "t3", date: "2026-05-03T12:00:00Z", description: "c", amount: -100 },
    ],
  });

  const CENTROS = [
    centro("pai", "cat-familia", "Pai"),
    centro("bariloche", "cat-viagem", "Bariloche"),
  ];

  it("move so o lancamento rotulado, deixando os outros na contraparte", () => {
    const { categorias } = cruzarCentrosDeCusto([FAMILIA, VIAGEM], CENTROS, [AMAZON], {
      t2: { categoryId: null, costCenterId: "bariloche" },
    });

    const familia = categorias.find((c) => c.id === "cat-familia")!;
    const viagem = categorias.find((c) => c.id === "cat-viagem")!;

    expect(familia.sent).toBe(200);
    expect(viagem.sent).toBe(100);
    expect(viagem.centros.find((c) => c.id === "bariloche")?.sent).toBe(100);
  });

  it("nao conta duas vezes: a soma continua sendo o total da contraparte", () => {
    const { categorias, semCategoria } = cruzarCentrosDeCusto([FAMILIA, VIAGEM], CENTROS, [AMAZON], {
      t1: { categoryId: null, costCenterId: "bariloche" },
    });

    const total = categorias.reduce((s, c) => s + c.sent, 0) + semCategoria.sent;
    expect(total).toBe(300);
  });

  it("rotulo so com categoria cai em 'sem centro' dela", () => {
    const { categorias } = cruzarCentrosDeCusto([FAMILIA, VIAGEM], CENTROS, [AMAZON], {
      t2: { categoryId: "cat-viagem", costCenterId: null },
    });

    const viagem = categorias.find((c) => c.id === "cat-viagem")!;
    expect(viagem.semCentro.sent).toBe(100);
  });

  it("contraparte com todos os lancamentos rotulados nao deixa resto", () => {
    const { categorias, semCategoria } = cruzarCentrosDeCusto([FAMILIA, VIAGEM], CENTROS, [AMAZON], {
      t1: { categoryId: null, costCenterId: "bariloche" },
      t2: { categoryId: null, costCenterId: "bariloche" },
      t3: { categoryId: null, costCenterId: "bariloche" },
    });

    expect(categorias.find((c) => c.id === "cat-familia")!.sent).toBe(0);
    expect(categorias.find((c) => c.id === "cat-viagem")!.sent).toBe(300);
    expect(semCategoria.sent).toBe(0);
  });

  it("rotulo apontando para centro inexistente cai em 'sem categoria'", () => {
    const { semCategoria } = cruzarCentrosDeCusto([FAMILIA, VIAGEM], CENTROS, [AMAZON], {
      t2: { categoryId: null, costCenterId: "apagado" },
    });

    expect(semCategoria.sent).toBe(100);
  });
});
