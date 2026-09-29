import { describe, expect, it } from "vitest";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import {
  aoAno,
  colunasDoInformeDiario,
  cotaEm,
  impostoDeFia,
  lerInformeDeFluxo,
  lerSerieSolta,
  lerSeriesJson,
  lerLinhaDoInformeDiario,
  mesesNecessarios,
  simularAporte,
  soDigitos,
} from "../cvm.mjs";

/**
 * O informe diario da CVM, e a conta do "e se eu tivesse aplicado aqui".
 *
 * A CVM esta fora do alcance de quem roda os testes, entao o que se prova aqui
 * e a leitura e a aritmetica — com linhas no formato real, incluindo o layout
 * novo em que apareceu CNPJ_FUNDO_CLASSE.
 */

const ANTIGO =
  "TP_FUNDO;CNPJ_FUNDO;DT_COMPTC;VL_TOTAL;VL_QUOTA;VL_PATRIM_LIQ;CAPTC_DIA;RESG_DIA;NR_COTST";
const NOVO =
  "TP_FUNDO_CLASSE;CNPJ_FUNDO_CLASSE;ID_SUBCLASSE;DT_COMPTC;VL_TOTAL;VL_QUOTA;VL_PATRIM_LIQ;CAPTC_DIA;RESG_DIA;NR_COTST";

describe("cabecalho do informe", () => {
  it("acha as colunas no layout antigo", () => {
    expect(colunasDoInformeDiario(ANTIGO)).toEqual({ cnpj: 1, data: 2, cota: 4 });
  });

  // A CVM mudou o layout no meio da serie. Indice chumbado leria patrimonio
  // liquido no lugar da cota e ninguem notaria.
  it("acha as colunas no layout novo, com a classe no lugar do fundo", () => {
    expect(colunasDoInformeDiario(NOVO)).toEqual({ cnpj: 1, data: 3, cota: 5 });
  });

  it("devolve nulo para uma linha que nao e cabecalho", () => {
    expect(colunasDoInformeDiario("FI;18248733000105;2026-09-01;1;2;3;0;0;1")).toBeNull();
    expect(colunasDoInformeDiario("")).toBeNull();
  });
});

describe("linha do informe", () => {
  const indices = colunasDoInformeDiario(ANTIGO)!;

  it("le cnpj, data e cota", () => {
    const linha = "FI;18.248.733/0001-05;2026-09-24;1000000.00;3.14159000;999999.00;0.00;0.00;42";
    expect(lerLinhaDoInformeDiario(indices, linha)).toEqual({
      cnpj: "18248733000105",
      dia: "2026-09-24",
      cota: 3.14159,
    });
  });

  it("aceita o cnpj ja sem pontuacao", () => {
    const linha = "FI;18248733000105;2026-09-24;1;2.5;3;0;0;1";
    expect(lerLinhaDoInformeDiario(indices, linha)?.cnpj).toBe("18248733000105");
  });

  // Cota zero ou vazia e fundo sem cotacao no dia; tratar como 0 faria o
  // contrafactual dividir por zero e imprimir Infinity como se fosse ganho.
  it("recusa linha sem cota utilizavel", () => {
    expect(lerLinhaDoInformeDiario(indices, "FI;18248733000105;2026-09-24;1;;3;0;0;1")).toBeNull();
    expect(lerLinhaDoInformeDiario(indices, "FI;18248733000105;2026-09-24;1;0;3;0;0;1")).toBeNull();
  });

  it("recusa data fora do formato e cnpj truncado", () => {
    expect(lerLinhaDoInformeDiario(indices, "FI;18248733000105;24/09/2026;1;2;3;0;0;1")).toBeNull();
    expect(lerLinhaDoInformeDiario(indices, "FI;182487;2026-09-24;1;2;3;0;0;1")).toBeNull();
  });
});

describe("a cota que vale para uma data", () => {
  const serie = [
    { cnpj: "x", dia: "2026-09-21", cota: 10 },
    { cnpj: "x", dia: "2026-09-22", cota: 11 },
    { cnpj: "x", dia: "2026-09-25", cota: 12 },
  ];

  it("usa a do proprio dia quando ela existe", () => {
    expect(cotaEm(serie, "2026-09-22")).toMatchObject({ dia: "2026-09-22", cota: 11, atraso: 0 });
  });

  // Aporte lancado num sabado e comum. A cota seguinte seria informacao que
  // ainda nao existia no dia do aporte.
  it("cai para a ultima anterior, e diz de quantos dias atras", () => {
    expect(cotaEm(serie, "2026-09-24")).toMatchObject({ dia: "2026-09-22", cota: 11, atraso: 2 });
  });

  it("devolve nulo antes do inicio da serie", () => {
    expect(cotaEm(serie, "2026-09-20")).toBeNull();
  });
});

describe("meses a baixar", () => {
  it("junta e ordena, sem repetir", () => {
    expect(mesesNecessarios(["2023-09-22", "2023-09-30", "2024-01-08", null, "abc"])).toEqual([
      "202309",
      "202401",
    ]);
  });
});

describe("o contrafactual", () => {
  const serie = [
    { cnpj: "x", dia: "2024-09-20", cota: 2 },
    { cnpj: "x", dia: "2026-09-25", cota: 3 },
  ];

  it("compra cotas na entrada e reavalia na saida", () => {
    const r = simularAporte({ aportado: 1000, compradoEm: "2024-09-20" }, serie, "2026-09-25")!;
    expect(r.cotas).toBe(500);
    expect(r.valor).toBe(1500);
    expect(r.dias).toBe(735);
  });

  it("devolve nulo quando o aporte e anterior a serie", () => {
    expect(simularAporte({ aportado: 1000, compradoEm: "2020-01-01" }, serie, "2026-09-25")).toBeNull();
  });

  it("devolve nulo sem dinheiro aportado", () => {
    expect(simularAporte({ aportado: 0, compradoEm: "2024-09-20" }, serie, "2026-09-25")).toBeNull();
  });
});

describe("ganho ao ano", () => {
  it("dobrar em um ano e 100%", () => {
    expect(aoAno(100, 200, 365)).toBeCloseTo(100, 6);
  });

  it("dobrar em dois anos e cerca de 41%", () => {
    expect(aoAno(100, 200, 730)).toBeCloseTo(41.42, 2);
  });

  // Anualizar duas semanas multiplica o ruido por vinte e seis e devolve um
  // numero com cara de medida.
  it("nao anualiza prazo curto demais", () => {
    expect(aoAno(100, 101, 15)).toBeNull();
  });
});

describe("imposto do fundo de acoes", () => {
  it("cobra 15% do ganho", () => {
    expect(impostoDeFia(1000, 1500)).toBe(75);
  });

  // Prejuizo nao gera imposto negativo — isso viraria um credito que nao existe.
  it("nao cobra nada no prejuizo", () => {
    expect(impostoDeFia(1000, 800)).toBe(0);
  });
});

describe("digitos", () => {
  it("tira a pontuacao do cnpj", () => {
    expect(soDigitos("18.248.733/0001-05")).toBe("18248733000105");
  });
});

describe("um informe inteiro, em streaming", () => {
  const ler = (texto: string, cnpj: string) =>
    lerInformeDeFluxo(Readable.from([texto]), cnpj, (f) =>
      createInterface({ input: f as never, crlfDelay: Infinity }),
    );

  const ARQUIVO = [
    ANTIGO,
    "FI;18.248.733/0001-05;2026-09-22;100;2.500000;100;0;0;5",
    "FI;11.111.111/0001-11;2026-09-22;100;9.990000;100;0;0;5",
    "FI;18.248.733/0001-05;2026-09-23;100;2.600000;100;0;0;5",
    "",
  ].join("\n");

  it("guarda so o fundo pedido, na ordem do arquivo", async () => {
    const pontos = await ler(ARQUIVO, "18248733000105");
    expect(pontos.map((p) => [p.dia, p.cota])).toEqual([
      ["2026-09-22", 2.5],
      ["2026-09-23", 2.6],
    ]);
  });

  // Um mes inteiro sao milhoes de linhas de todos os fundos do pais. Se o
  // filtro falhasse, o cache teria o Brasil dentro.
  it("nao traz nada quando o fundo nao aparece", async () => {
    expect(await ler(ARQUIVO, "99999999999999")).toEqual([]);
  });

  it("reclama quando nao ha cabecalho reconhecivel", async () => {
    await expect(ler("a;b;c\n1;2;3", "18248733000105")).rejects.toThrow(/cabecalho/i);
  });
});

describe("serie colada de qualquer lugar", () => {
  it("le data ISO com ponto decimal", () => {
    expect(lerSerieSolta("2026-09-22;3.141590\n2026-09-23;3.150000")).toEqual([
      { cnpj: null, dia: "2026-09-22", cota: 3.14159 },
      { cnpj: null, dia: "2026-09-23", cota: 3.15 },
    ]);
  });

  it("le data brasileira com virgula decimal", () => {
    expect(lerSerieSolta("22/09/2026;3,141590")).toEqual([
      { cnpj: null, dia: "2026-09-22", cota: 3.14159 },
    ]);
  });

  // "1.234,56" e "1,234.56" sao o mesmo numero em convencoes diferentes. O
  // ultimo separador e o decimal nos dois casos.
  it("resolve milhar e decimal pelo ultimo separador", () => {
    expect(lerSerieSolta("2026-09-22;1.234,56")[0].cota).toBe(1234.56);
    expect(lerSerieSolta("2026-09-22;1,234.56")[0].cota).toBe(1234.56);
  });

  // Numa serie de cotas "1.234567" e uma cota de um e pouco. Ler como milhar
  // daria 1.234.567 e o contrafactual erraria por seis ordens de grandeza.
  it("com um separador so, ele e o decimal", () => {
    expect(lerSerieSolta("2026-09-22;1.234567")[0].cota).toBe(1.234567);
  });

  it("aceita tab, virgula e espaco como separador de coluna", () => {
    expect(lerSerieSolta("2026-09-22\t2,50")[0].cota).toBe(2.5);
    expect(lerSerieSolta("2026-09-22 2.50")[0].cota).toBe(2.5);
  });

  // Os digitos da propria data nao podem virar candidatos a cota.
  it("nao confunde a data com o numero", () => {
    expect(lerSerieSolta("22/09/2026;7,00")[0].cota).toBe(7);
    expect(lerSerieSolta("2026-09-22,7.00")[0].cota).toBe(7);
  });

  it("pula cabecalho e linhas sem data", () => {
    const texto = ["Data;Cota", "", "referencia do fundo", "2026-09-22;2.5"].join("\n");
    expect(lerSerieSolta(texto)).toHaveLength(1);
  });

  it("devolve ordenado por data, mesmo vindo embaralhado", () => {
    const texto = "2026-09-25;3\n2026-09-21;1\n2026-09-23;2";
    expect(lerSerieSolta(texto).map((p) => p.cota)).toEqual([1, 2, 3]);
  });
});

describe("series em JSON, uma chave por dia", () => {
  const ARQUIVO = {
    "2013-07-10": { CDI: 30.77408, IBOV: 45483.43, fundo: 100 },
    "2013-07-11": { CDI: 30.78316, IBOV: 46626.26, fundo: 99.99898655 },
    "2015-10-17": { IBOV: 47236.11 },
    "2026-09-28": { CDI: 108.4817384, IBOV: 182991.13, fundo: 789.88172719 },
    lixo: { fundo: 1 },
  };

  it("separa uma serie por nome", () => {
    const series = lerSeriesJson(JSON.stringify(ARQUIVO));
    expect([...series.keys()].sort()).toEqual(["CDI", "IBOV", "fundo"]);
  });

  // Fim de semana e feriado vem so com IBOV repetido, sem cota do fundo. A
  // serie do fundo nao pode ganhar um furo nem um ponto inventado.
  it("um dia sem a serie nao entra naquela serie", () => {
    const series = lerSeriesJson(JSON.stringify(ARQUIVO));
    expect(series.get("fundo")!.map((p) => p.dia)).toEqual([
      "2013-07-10",
      "2013-07-11",
      "2026-09-28",
    ]);
    expect(series.get("IBOV")).toHaveLength(4);
  });

  it("ignora chave que nao e data", () => {
    const series = lerSeriesJson(JSON.stringify(ARQUIVO));
    expect(series.get("fundo")!.some((p) => p.dia === "lixo")).toBe(false);
  });

  it("aceita o objeto ja desserializado", () => {
    expect(lerSeriesJson(ARQUIVO).get("fundo")).toHaveLength(3);
  });

  // O nivel do indice nao importa: so a razao entra na conta. CDI em 108 e
  // cota em 789 tem que dar a mesma resposta para o mesmo aporte.
  it("o contrafactual funciona em qualquer escala", () => {
    const series = lerSeriesJson(ARQUIVO);
    const fundo = simularAporte(
      { aportado: 1000, compradoEm: "2013-07-10" },
      series.get("fundo")!,
      "2026-09-28",
    )!;
    const cdi = simularAporte(
      { aportado: 1000, compradoEm: "2013-07-10" },
      series.get("CDI")!,
      "2026-09-28",
    )!;
    expect(fundo.valor).toBeCloseTo(7898.8173, 2);
    expect(cdi.valor).toBeCloseTo(3525.1009, 2);
  });
});
