import { describe, expect, it } from "vitest";
import {
  aggregateCounterparties,
  groupByCategory,
  extractCounterparty,
  maskDocument,
  nameFromDescription,
  NAO_IDENTIFICADA,
} from "../counterparties";

const MEU_CPF = { type: "CPF", value: "136.557.127-07" };
const OUTRO_CPF = { type: "CPF", value: "987.654.321-00" };

describe("extractCounterparty", () => {
  it("na saida, a contraparte e quem recebeu", () => {
    const c = extractCounterparty(
      { payer: { documentNumber: MEU_CPF, name: null }, receiver: { documentNumber: OUTRO_CPF, name: "Joao Diarista" } },
      -320,
      "Pix enviado - Joao Diarista",
    );
    expect(c).toMatchObject({ name: "Joao Diarista", key: "98765432100", self: false });
  });

  it("na entrada, a contraparte e quem pagou", () => {
    const c = extractCounterparty(
      { payer: { documentNumber: OUTRO_CPF, name: "Cliente Alfa" }, receiver: { documentNumber: MEU_CPF, name: null } },
      1500,
      "Pix recebido - Cliente Alfa",
    );
    expect(c).toMatchObject({ name: "Cliente Alfa", key: "98765432100" });
  });

  it("marca como propria a transferencia entre suas contas", () => {
    const c = extractCounterparty(
      { payer: { documentNumber: MEU_CPF, name: null }, receiver: { documentNumber: MEU_CPF, name: null } },
      -2000,
      "Pix enviado",
    );
    expect(c?.self).toBe(true);
  });

  it("recorre a descricao quando paymentData nao traz nome", () => {
    const c = extractCounterparty(
      { payer: { documentNumber: MEU_CPF }, receiver: { documentNumber: OUTRO_CPF, name: null } },
      -100,
      "Pix enviado - Padaria do Bairro",
    );
    expect(c?.name).toBe("Padaria do Bairro");
  });

  it("marca como nao identificada quando o lado da contraparte vem nulo", () => {
    const c = extractCounterparty(
      { payer: null, receiver: { documentNumber: null, name: null } },
      450,
      "Transferencia recebida",
    );
    expect(c?.key).toBe(NAO_IDENTIFICADA);
  });

  it("devolve null quando nao ha paymentData", () => {
    expect(extractCounterparty(null, -50, "Compra no cartao")).toBeNull();
  });

  it("usa o nome normalizado como chave quando nao ha documento", () => {
    const c = extractCounterparty(
      { payer: { documentNumber: MEU_CPF }, receiver: { name: "José da Silva" } },
      -80,
      "Pix enviado",
    );
    expect(c?.key).toBe("JOSE DA SILVA");
  });
});

describe("nameFromDescription", () => {
  it("pega o texto apos o hifen", () => {
    expect(nameFromDescription("Pix enviado - Maria Locadora")).toBe("Maria Locadora");
  });

  it("devolve undefined sem separador", () => {
    expect(nameFromDescription("Compra no debito")).toBeUndefined();
  });
});

describe("maskDocument", () => {
  it("mascara CPF preservando os ultimos digitos", () => {
    expect(maskDocument("98765432100")).toBe("•••.•••.321-00");
  });

  it("mascara CNPJ", () => {
    expect(maskDocument("12345678000199")).toBe("••.•••.678/0001-99");
  });

  it("lida com ausencia de documento", () => {
    expect(maskDocument(undefined)).toBe("");
  });
});

describe("aggregateCounterparties", () => {
  const parte = (key: string, name: string) => ({ key, name, self: false });

  const transacoes = [
    { amount: -320, date: "2026-08-08T15:00:00Z", counterparty: parte("111", "Joao") },
    { amount: -320, date: "2026-08-16T15:00:00Z", counterparty: parte("111", "Joao") },
    { amount: 1500, date: "2026-08-21T15:00:00Z", counterparty: parte("222", "Cliente Alfa") },
    { amount: -2600, date: "2026-08-05T15:00:00Z", counterparty: parte("333", "Maria") },
    { amount: -50, date: "2026-08-02T15:00:00Z", counterparty: null },
  ];

  it("separa enviado de recebido e calcula o liquido", () => {
    const [primeiro] = aggregateCounterparties(transacoes).filter((c) => c.key === "111");
    expect(primeiro).toMatchObject({ sent: 640, received: 0, net: -640, count: 2 });
  });

  it("ordena pelo volume movimentado", () => {
    const chaves = aggregateCounterparties(transacoes).map((c) => c.key);
    expect(chaves).toEqual(["333", "222", "111"]);
  });

  it("ignora transacoes sem contraparte", () => {
    expect(aggregateCounterparties(transacoes)).toHaveLength(3);
  });

  it("guarda a data mais recente da contraparte", () => {
    const joao = aggregateCounterparties(transacoes).find((c) => c.key === "111");
    expect(joao?.lastDate).toBe("2026-08-16T15:00:00Z");
  });

  it("aplica apelido e categoria do cadastro", () => {
    const resultado = aggregateCounterparties(transacoes, {
      "333": { alias: "Aluguel do apartamento", category: "Moradia" },
    });
    const maria = resultado.find((c) => c.key === "333");
    expect(maria).toMatchObject({ name: "Aluguel do apartamento", category: "Moradia" });
  });

  it("rotula a contraparte nao identificada de forma legivel", () => {
    const resultado = aggregateCounterparties([
      { amount: 450, date: "2026-08-13T15:00:00Z", counterparty: { key: NAO_IDENTIFICADA, self: false } },
    ]);
    expect(resultado[0].name).toBe("Contraparte nao identificada");
  });
});

describe("classificacao em dois niveis", () => {
  const transacoes = [
    {
      id: "1",
      amount: -1200,
      date: "2026-08-10T15:00:00Z",
      description: "Hotel Fazenda Cascatinha",
      category: "Travel",
      counterparty: { key: "hotel", name: "Hotel Fazenda Cascatinha", self: false },
    },
    {
      id: "2",
      amount: -430,
      date: "2026-08-11T15:00:00Z",
      description: "Posto de gasolina",
      category: "Transport",
      counterparty: { key: "posto", name: "Posto Estrada", self: false },
    },
    {
      id: "3",
      amount: -2600,
      date: "2026-08-05T15:00:00Z",
      description: "Aluguel",
      category: "Housing",
      counterparty: { key: "maria", name: "Maria", self: false },
    },
  ];

  const cadastro = {
    hotel: { category: "Viagem", subcategory: "Viagem FDS Familia" },
    posto: { category: "Viagem", subcategory: "Viagem FDS Familia" },
    maria: { category: "Moradia", subcategory: "Aluguel" },
  };

  it("agrupa subcategorias sob a categoria mae", () => {
    const grupos = groupByCategory(aggregateCounterparties(transacoes, cadastro));
    const viagem = grupos.find((g) => g.category === "Viagem");

    expect(viagem?.sent).toBe(1630);
    expect(viagem?.subcategories).toHaveLength(1);
    expect(viagem?.subcategories[0]).toMatchObject({
      subcategory: "Viagem FDS Familia",
      sent: 1630,
      counterparties: 2,
    });
  });

  it("ordena categorias pelo volume", () => {
    const grupos = groupByCategory(aggregateCounterparties(transacoes, cadastro));
    expect(grupos.map((g) => g.category)).toEqual(["Moradia", "Viagem"]);
  });

  it("agrupa sob rotulo proprio o que nao foi classificado", () => {
    const grupos = groupByCategory(aggregateCounterparties(transacoes));
    expect(grupos).toHaveLength(1);
    expect(grupos[0].category).toBe("Sem categoria");
  });

  it("sugere a categoria mais frequente da Pluggy, traduzida", () => {
    const [hotel] = aggregateCounterparties([transacoes[0]]);
    expect(hotel.suggestedCategory).toBe("Viagem");
  });

  it("sugestao nao preenche a categoria: so o cadastro classifica", () => {
    const [hotel] = aggregateCounterparties([transacoes[0]]);
    expect(hotel.category).toBeUndefined();
    expect(hotel.suggestedCategory).toBeDefined();
  });

  it("guarda os lancamentos que compoem cada contraparte", () => {
    const [hotel] = aggregateCounterparties([transacoes[0]]);
    expect(hotel.transactions).toHaveLength(1);
    expect(hotel.transactions[0].description).toBe("Hotel Fazenda Cascatinha");
  });
});
