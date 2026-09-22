import { describe, expect, it } from "vitest";
import {
  casarComOTitulo,
  doUltimoDia,
  lerPrecoTaxa,
  spreadEmBps,
} from "../tesouro.mjs";

/**
 * O arquivo diario do Tesouro Transparente.
 *
 * As linhas abaixo sao do arquivo de verdade, copiadas como ele vem: ponto e
 * virgula, virgula decimal e data dd/mm/aaaa. Um parser testado contra um
 * formato inventado por mim nao testaria nada.
 */
const CABECALHO =
  "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";

const ARQUIVO = [
  CABECALHO,
  "Tesouro Selic;01/03/2031;18/09/2026;0,07;0,08;19851,50;19832,55;19832,55",
  "Tesouro Selic;01/03/2028;18/09/2026;0,02;0,03;19911,17;19898,12;19898,12",
  "Tesouro Selic;01/03/2029;18/09/2026;0,03;0,04;19900,69;19885,68;19885,68",
  "Tesouro Renda+ Aposentadoria Extra 2065;15/12/2084;18/09/2026;7,02;7,14;196,80;186,95;186,95",
  // Um dia anterior, para o filtro do mais recente ter o que descartar.
  "Tesouro Renda+ Aposentadoria Extra 2065;15/12/2084;17/09/2026;6,98;7,10;199,00;189,12;189,12",
].join("\n");

describe("lerPrecoTaxa", () => {
  it("le as oito colunas do arquivo como ele vem", () => {
    const linhas = lerPrecoTaxa(ARQUIVO);
    expect(linhas).toHaveLength(5);

    const renda = linhas.find((l) => l.base === "2026-09-18" && l.titulo.includes("Renda+"))!;
    expect(renda.titulo).toBe("Tesouro Renda+ Aposentadoria Extra 2065");
    expect(renda.vence).toBe("2084-12-15");
    expect(renda.taxaCompra).toBe(7.02);
    expect(renda.taxaVenda).toBe(7.14);
    expect(renda.precoCompra).toBe(196.8);
    expect(renda.precoVenda).toBe(186.95);
  });

  // O cabecalho vem "Manha" ou "Manhã" conforme o arquivo foi gravado, e
  // depender disso seria quebrar o parser por um til.
  it("acha as colunas com acento tambem", () => {
    const comAcento = ARQUIVO.replace(/Manha/g, "Manhã");
    expect(lerPrecoTaxa(comAcento)).toHaveLength(5);
  });

  it("devolve vazio quando o arquivo mudou de forma", () => {
    // Adivinhar as colunas produziria numeros plausiveis e errados.
    expect(lerPrecoTaxa("Titulo;Preco\nSelic;100")).toEqual([]);
    expect(lerPrecoTaxa("")).toEqual([]);
  });

  it("pula linha estragada sem derrubar o resto", () => {
    const sujo = [
      CABECALHO,
      "Tesouro Selic;01/03/2031;18/09/2026;0,07;0,08;19851,50;19832,55;19832,55",
      "Tesouro Selic;lixo;18/09/2026;0,07;0,08;19851,50;19832,55;19832,55",
      "linha curta demais",
      "Tesouro Selic;01/03/2028;18/09/2026;0,02;0,03;19911,17;19898,12;19898,12",
    ].join("\n");

    expect(lerPrecoTaxa(sujo)).toHaveLength(2);
  });
});

describe("doUltimoDia", () => {
  it("fica so com a foto mais recente", () => {
    const hoje = doUltimoDia(lerPrecoTaxa(ARQUIVO));
    expect(hoje).toHaveLength(4);
    expect(hoje.every((l) => l.base === "2026-09-18")).toBe(true);
  });

  // A ordem do arquivo nao e garantida por nada; assumir que as ultimas linhas
  // sao as mais novas daria a foto de ontem sem avisar.
  it("nao depende da ordem das linhas", () => {
    const invertido = lerPrecoTaxa(ARQUIVO).reverse();
    expect(doUltimoDia(invertido).every((l) => l.base === "2026-09-18")).toBe(true);
  });

  it("aguenta arquivo vazio", () => {
    expect(doUltimoDia([])).toEqual([]);
  });
});

describe("casarComOTitulo", () => {
  const hoje = doUltimoDia(lerPrecoTaxa(ARQUIVO));

  // O defeito que a primeira versao tinha: ela casava pelo preco, e o preco da
  // corretora E o dado defasado. Das quatro custodias da Renda+ so o Inter
  // casava — justamente o unico que ja estava certo.
  it("casa pelo vencimento mesmo com o preco da corretora defasado", () => {
    for (const puDefasado of [189.12, 188.48, 186.95, 199.0]) {
      const achado = casarComOTitulo(
        { precoUnitario: puDefasado, vence: "2084-12-15" },
        hoje,
      );
      expect(achado?.precoVenda).toBe(186.95);
      expect(achado?.taxaCompra).toBe(7.02);
    }
  });

  it("o preco desempata quando dois titulos vencem no mesmo dia", () => {
    const gemeos = [
      ...hoje,
      // Mesmo vencimento, estrutura diferente: PU bem distante.
      {
        titulo: "Tesouro IPCA+ com Juros Semestrais 2084",
        vence: "2084-12-15",
        base: "2026-09-18",
        taxaCompra: 7.1,
        taxaVenda: 7.22,
        precoCompra: 4200,
        precoVenda: 4100,
      },
    ];

    expect(
      casarComOTitulo({ precoUnitario: 189.12, vence: "2084-12-15" }, gemeos)?.titulo,
    ).toContain("Renda+");
    expect(
      casarComOTitulo({ precoUnitario: 4050, vence: "2084-12-15" }, gemeos)?.titulo,
    ).toContain("Juros Semestrais");
  });

  it("empate de verdade devolve nulo em vez de chutar", () => {
    const gemeos = [
      ...hoje,
      {
        titulo: "Outro 2084",
        vence: "2084-12-15",
        base: "2026-09-18",
        taxaCompra: 7.03,
        taxaVenda: 7.15,
        precoCompra: 196.9,
        precoVenda: 187.0,
      },
    ];

    expect(casarComOTitulo({ precoUnitario: 186.97, vence: "2084-12-15" }, gemeos)).toBeNull();
  });

  // Sem vencimento nao ha outra ancora: so a coincidencia de preco sustenta.
  it("sem vencimento volta a exigir o preco", () => {
    expect(casarComOTitulo({ precoUnitario: 186.95, vence: null }, hoje)?.taxaCompra).toBe(7.02);
    expect(casarComOTitulo({ precoUnitario: 189.12, vence: null }, hoje)).toBeNull();
  });

  it("vencimento que nao existe no arquivo cai no preco", () => {
    expect(
      casarComOTitulo({ precoUnitario: 186.95, vence: "2099-01-01" }, hoje)?.taxaCompra,
    ).toBe(7.02);
  });

  it("sem vencimento e sem preco nao ha o que casar", () => {
    expect(casarComOTitulo({ precoUnitario: null, vence: null }, hoje)).toBeNull();
    expect(casarComOTitulo({ precoUnitario: 0, vence: null }, hoje)).toBeNull();
  });

  // Tres Selic ficam dentro de 0,3% um do outro: so o preco escolheria errado.
  it("recusa empate entre vencimentos proximos sem ancora", () => {
    expect(casarComOTitulo({ precoUnitario: 19890, vence: null }, hoje, 0.01)).toBeNull();
  });
});

describe("spreadEmBps", () => {
  it("le o spread do arquivo em vez de assumir", () => {
    const [renda] = doUltimoDia(lerPrecoTaxa(ARQUIVO)).filter((l) =>
      l.titulo.includes("Renda+"),
    );
    expect(spreadEmBps(renda)).toBe(12);

    const [selic] = doUltimoDia(lerPrecoTaxa(ARQUIVO)).filter((l) =>
      l.vence === "2031-03-01",
    );
    expect(spreadEmBps(selic)).toBe(1);
  });
});
