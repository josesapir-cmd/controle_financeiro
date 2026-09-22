import { describe, expect, it } from "vitest";
import {
  agruparPapeis,
  classeDoPapel,
  agruparPorClasse,
  creditoDeImpostoRetido,
  remarcarAoPrecoOficial,
  semZerados,
  type PapelNaCarteira,
} from "../carteira";

/**
 * O nome e o agrupamento dos papeis da carteira.
 *
 * A Pluggy manda codigo do Open Finance; a tela precisa de portugues. E o
 * agrupamento tem uma regra que erra calado: um papel que caisse em dois
 * grupos, ou um total que nao fecha com a soma dos saldos.
 */

function papel(parcial: Partial<PapelNaCarteira>): PapelNaCarteira {
  return {
    id: "x",
    nome: "Papel",
    instituicao: "BTG Pactual",
    tipo: "FIXED_INCOME",
    subtipo: null,
    saldo: 0,
    aportado: null,
    lucro: null,
    taxa: null,
    vence: null,
    ...parcial,
  };
}

describe("classeDoPapel", () => {
  it("prefere o subtipo, que e o rotulo mais especifico", () => {
    expect(classeDoPapel("FIXED_INCOME", "CDB")).toBe("CDB");
    expect(classeDoPapel("MUTUAL_FUND", "MULTIMARKET_FUND")).toBe(
      "Fundo multimercado",
    );
  });

  it("cai no tipo quando o subtipo nao tem traducao", () => {
    expect(classeDoPapel("FIXED_INCOME", "ALGO_NOVO")).toBe("Renda fixa");
    expect(classeDoPapel("MUTUAL_FUND", null)).toBe("Fundo");
  });

  it("mostra o codigo cru em vez de inventar um nome", () => {
    // Um codigo desconhecido aparecendo na tela e um pedido de traducao; um
    // "Outros" generico esconderia que existe algo novo.
    expect(classeDoPapel("ESTRUTURADO", "BOX_DE_3_PONTAS")).toBe(
      "BOX_DE_3_PONTAS",
    );
    expect(classeDoPapel("ESTRUTURADO", null)).toBe("ESTRUTURADO");
  });

  it("traduz tambem as classes que so existem em ativo manual", () => {
    // Cripto, imovel e participacao nao chegam por Open Finance nenhum; sao
    // digitadas, e mesmo assim precisam de nome na tabela de classes.
    expect(classeDoPapel("CRYPTO", null)).toBe("Cripto");
    expect(classeDoPapel("REAL_ESTATE", null)).toBe("Imovel");
    expect(classeDoPapel("FIXED_INCOME", "FIDC")).toBe("FIDC");
  });
});

describe("agruparPapeis", () => {
  it("junta os lotes do mesmo titulo numa linha so", () => {
    // O caso que motivou: cinco NTN-B 2084 compradas em datas diferentes
    // chegam da Pluggy como cinco posicoes identicas no nome e no vencimento.
    const lotes = [322249.03, 225324.32, 219074.44, 213114.37, 207791.29].map(
      (saldo, i) =>
        papel({
          id: `ntnb-${i}`,
          nome: "TESOURO DIRETO - NTN-B1",
          instituicao: "BTGPactual",
          subtipo: "TREASURY",
          vence: "2084-12-15",
          saldo,
        }),
    );

    const [linha] = agruparPapeis(lotes);

    expect(agruparPapeis(lotes)).toHaveLength(1);
    expect(linha.posicoes).toBe(5);
    expect(linha.saldo).toBeCloseTo(1187553.45, 2);
    expect(linha.nome).toBe("TESOURO DIRETO - NTN-B1");
    expect(linha.vence).toBe("2084-12-15");
  });

  it("soma as custodias numa linha e guarda cada uma por dentro", () => {
    // O total do instrumento e a pergunta de cima; onde esta custodiado e a de
    // baixo, e so importa na hora de resgatar.
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "NTN-B 2084",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 100,
      }),
      papel({
        id: "b",
        nome: "NTN-B 2084",
        instituicao: "XP",
        vence: "2084-12-15",
        saldo: 200,
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].saldo).toBe(300);
    expect(linhas[0].custodias.map((c) => [c.instituicao, c.saldo])).toEqual([
      ["XP", 200],
      ["BTG", 100],
    ]);
  });

  it("nao escolhe uma custodia para representar as outras", () => {
    const [linha] = agruparPapeis([
      papel({ id: "a", nome: "NTN-B", instituicao: "BTG", saldo: 100 }),
      papel({ id: "b", nome: "NTN-B", instituicao: "XP", saldo: 900 }),
    ]);

    // Escrever "XP" ali diria que os 1.000 estao la, e 100 estao no BTG.
    expect(linha.instituicao).toBe("2 custodias");
  });

  it("com uma custodia so, o nome dela e o da linha", () => {
    const [linha] = agruparPapeis([
      papel({ id: "a", nome: "CDB", instituicao: "BTG", saldo: 100 }),
      papel({ id: "b", nome: "CDB", instituicao: "BTG", saldo: 200 }),
    ]);

    expect(linha.instituicao).toBe("BTG");
    expect(linha.custodias).toHaveLength(1);
    expect(linha.custodias[0].posicoes).toBe(2);
  });

  it("pondera a taxa dentro de cada custodia, e nao so no total", () => {
    const [linha] = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 1000,
        taxa: 10,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 3000,
        taxa: 14,
      }),
      papel({ id: "c", nome: "CDB", instituicao: "XP", saldo: 1000, taxa: 20 }),
    ]);

    const porNome = Object.fromEntries(
      linha.custodias.map((c) => [c.instituicao, c.taxa]),
    );
    expect(porNome.BTG).toBeCloseTo(13, 10);
    expect(porNome.XP).toBe(20);
    // O total pondera as cinco mil, nao a media das duas custodias.
    expect(linha.taxa).toBeCloseTo(
      (10 * 1000 + 14 * 3000 + 20 * 1000) / 5000,
      10,
    );
  });

  it("nao junta vencimentos diferentes do mesmo emissor", () => {
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB Banco X",
        instituicao: "BTG",
        vence: "2027-01-10",
        saldo: 100,
      }),
      papel({
        id: "b",
        nome: "CDB Banco X",
        instituicao: "BTG",
        vence: "2029-01-10",
        saldo: 200,
      }),
    ]);

    expect(linhas).toHaveLength(2);
  });

  it("soma lucro e aporte, preservando o desconhecido", () => {
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 100,
        lucro: 10,
        aportado: 90,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 200,
        lucro: 25,
        aportado: 175,
      }),
    ]);

    expect(linhas[0].lucro).toBe(35);
    expect(linhas[0].aportado).toBe(265);
  });

  it("nao transforma lucro desconhecido em zero", () => {
    // Nenhum informa: o grupo tambem nao sabe. Zero diria que nao rendeu nada.
    const semInfo = agruparPapeis([
      papel({ id: "a", nome: "Fundo", instituicao: "BTG", saldo: 100 }),
      papel({ id: "b", nome: "Fundo", instituicao: "BTG", saldo: 200 }),
    ]);
    expect(semInfo[0].lucro).toBeNull();

    // Um informa e o outro nao: o que se sabe e o que foi informado.
    const parcial = agruparPapeis([
      papel({
        id: "a",
        nome: "Fundo",
        instituicao: "BTG",
        saldo: 100,
        lucro: 7,
      }),
      papel({ id: "b", nome: "Fundo", instituicao: "BTG", saldo: 200 }),
    ]);
    expect(parcial[0].lucro).toBe(7);
  });

  it("pondera a taxa pelo saldo, nao pela contagem", () => {
    const [linha] = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 1000,
        taxa: 10,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 3000,
        taxa: 14,
      }),
    ]);

    // Media simples daria 12; a carteira rende 13.
    expect(linha.taxa).toBeCloseTo(13, 10);
  });

  it("ignora na media a posicao que nao informa taxa", () => {
    const [linha] = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 1000,
        taxa: 10,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "BTG",
        saldo: 3000,
        taxa: null,
      }),
    ]);

    // Contar a sem taxa como zero daria 2,5% — uma taxa que ninguem contratou.
    expect(linha.taxa).toBe(10);
  });

  it("junta lotes que so diferem em espaco ou caixa no nome", () => {
    // O que a corretora manda nao e estavel: a mesma NTN-B chega ora com dois
    // espacos, ora em caixa diferente. Isso nao faz dela outro papel, mas
    // separava as linhas — o sintoma exato que o agrupamento existe para tirar.
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "TESOURO DIRETO - NTN-B1",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 100,
      }),
      papel({
        id: "b",
        nome: "TESOURO  DIRETO - NTN-B1 ",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 200,
      }),
      papel({
        id: "c",
        nome: "Tesouro Direto - NTN-B1",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 300,
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].saldo).toBe(600);
    expect(linhas[0].posicoes).toBe(3);
    // O nome exibido e o do primeiro lote, cru: normalizar a chave nao e
    // reescrever o que a corretora chamou o papel.
    expect(linhas[0].nome).toBe("TESOURO DIRETO - NTN-B1");
  });

  it("com apelido, une nomes sem nada em comum", () => {
    // A mesma NTN-B chega com quatro nomes, um por custodia. Depois que o
    // usuario declara que sao o mesmo papel, o servico entrega o apelido em
    // `nome` e marca `apelidado` — e o agrupamento passa a olhar so para ele.
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "Renda+ 2065",
        instituicao: "Inter",
        saldo: 100,
        apelidado: true,
      }),
      papel({
        id: "b",
        nome: "Renda+ 2065",
        instituicao: "Nubank",
        saldo: 200,
        apelidado: true,
      }),
      papel({
        id: "c",
        nome: "Renda+ 2065",
        instituicao: "XP",
        saldo: 300,
        apelidado: true,
      }),
      papel({
        id: "d",
        nome: "Renda+ 2065",
        instituicao: "BTG",
        saldo: 400,
        apelidado: true,
      }),
    ]);

    expect(linhas).toHaveLength(1);
    expect(linhas[0].saldo).toBe(1000);
    expect(linhas[0].custodias).toHaveLength(4);
    expect(linhas[0].instituicao).toBe("4 custodias");
  });

  it("apelidado ignora o vencimento, inclusive quando so uma custodia informa", () => {
    // A XP manda "NTN-B1" sem data. Exigir que o vencimento confira desfaria a
    // uniao que a pessoa acabou de fazer a mao.
    const linhas = agruparPapeis([
      // A sem data vem PRIMEIRO de proposito: e o grupo que herdaria o nulo.
      papel({
        id: "a",
        nome: "Renda+ 2065",
        instituicao: "XP",
        vence: null,
        saldo: 200,
        apelidado: true,
      }),
      papel({
        id: "b",
        nome: "Renda+ 2065",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 100,
        apelidado: true,
      }),
    ]);

    expect(linhas).toHaveLength(1);
    // E a data que existe nao se perde para o nulo do vizinho.
    expect(linhas[0].vence).toBe("2084-12-15");
  });

  it("nao mostra o vencimento de um quando o grupo tem varios", () => {
    // Juntar CDBs de bancos diferentes junta vencimentos de verdade diferentes.
    // Mostrar o primeiro diria que a posicao inteira vence naquele dia.
    const [linha] = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        vence: "2027-11-30",
        saldo: 100,
        apelidado: true,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "Inter",
        vence: "2029-03-05",
        saldo: 200,
        apelidado: true,
      }),
    ]);

    expect(linha.saldo).toBe(300);
    expect(linha.vence).toBeNull();
    expect(linha.vencimentosVariados).toBe(true);
  });

  it("um vencimento que reaparece depois nao ressuscita a data", () => {
    // Tres lotes, dois com a mesma data: uma vez que o grupo virou variado, ele
    // nao volta atras so porque o terceiro coincide com o primeiro.
    const [linha] = agruparPapeis([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        vence: "2027-11-30",
        saldo: 100,
        apelidado: true,
      }),
      papel({
        id: "b",
        nome: "CDB",
        instituicao: "Inter",
        vence: "2029-03-05",
        saldo: 200,
        apelidado: true,
      }),
      papel({
        id: "c",
        nome: "CDB",
        instituicao: "Nubank",
        vence: "2027-11-30",
        saldo: 300,
        apelidado: true,
      }),
    ]);

    expect(linha.vence).toBeNull();
  });

  it("sem apelido, o vencimento continua separando", () => {
    // A data e o que separa de verdade dois titulos de nome parecido.
    const linhas = agruparPapeis([
      papel({
        id: "a",
        nome: "NTN-B",
        instituicao: "BTG",
        vence: "2084-12-15",
        saldo: 100,
      }),
      papel({
        id: "b",
        nome: "NTN-B",
        instituicao: "BTG",
        vence: "2065-12-15",
        saldo: 200,
      }),
    ]);

    expect(linhas).toHaveLength(2);
  });

  it("ordena do maior saldo para o menor", () => {
    const linhas = agruparPapeis([
      papel({ id: "a", nome: "Pequeno", instituicao: "BTG", saldo: 10 }),
      papel({ id: "b", nome: "Grande", instituicao: "BTG", saldo: 500 }),
      papel({ id: "c", nome: "Grande", instituicao: "BTG", saldo: 500 }),
    ]);

    expect(linhas.map((l) => l.nome)).toEqual(["Grande", "Pequeno"]);
    expect(linhas[0].saldo).toBe(1000);
  });
});

describe("agruparPorClasse", () => {
  it("junta CDB de bancos diferentes sem ninguem declarar nada", () => {
    // O motivo de existir: perguntar "quanto tenho em CDB" nao deveria exigir
    // cadastrar apelido, rodar comando nem migrar banco. O subtipo ja vem da
    // corretora.
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "CDB BTG 2027",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 287110,
        vence: "2027-11-30",
      }),
      papel({
        id: "b",
        nome: "CDB Inter 2029",
        instituicao: "Inter",
        subtipo: "CDB",
        saldo: 141200,
        vence: "2029-03-05",
      }),
      papel({
        id: "c",
        nome: "Nubank RDB",
        instituicao: "Nubank",
        subtipo: "CDB",
        saldo: 18720.35,
        vence: "2028-06-12",
      }),
    ]);

    expect(classes).toHaveLength(1);
    expect(classes[0].nome).toBe("CDB");
    expect(classes[0].saldo).toBeCloseTo(447030.35, 2);
    expect(classes[0].posicoes).toBe(3);
    // Os tres instrumentos ficam por dentro, e nao somem.
    expect(classes[0].instrumentos.map((i) => i.nome)).toEqual([
      "CDB BTG 2027",
      "CDB Inter 2029",
      "Nubank RDB",
    ]);
  });

  it("junta o Tesouro das quatro custodias sem apelido nenhum", () => {
    // Cada custodia escreve o nome de um jeito, e todas mandam TREASURY.
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "Tesouro Renda+ Aposentadoria Extra 2065",
        instituicao: "Inter",
        subtipo: "TREASURY",
        saldo: 71531.96,
      }),
      papel({
        id: "b",
        nome: "Tesouro RendA+ 2065",
        instituicao: "Nubank",
        subtipo: "TREASURY",
        saldo: 62366.17,
      }),
      papel({
        id: "c",
        nome: "NTN-B1",
        instituicao: "XP",
        subtipo: "TREASURY",
        saldo: 404012,
      }),
      papel({
        id: "d",
        nome: "TESOURO DIRETO - NTN-B1",
        instituicao: "BTG",
        subtipo: "TREASURY",
        saldo: 4172862.82,
      }),
    ]);

    expect(classes).toHaveLength(1);
    expect(classes[0].nome).toBe("Tesouro Direto");
    expect(classes[0].saldo).toBeCloseTo(4710772.95, 2);
    // Sem apelido eles continuam sendo quatro instrumentos por dentro.
    expect(classes[0].instrumentos).toHaveLength(4);
  });

  it("nao mistura classes diferentes, e ordena do maior para o menor", () => {
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "CDB BTG",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 100,
      }),
      papel({
        id: "b",
        nome: "NTN-B",
        instituicao: "BTG",
        subtipo: "TREASURY",
        saldo: 900,
      }),
      papel({
        id: "c",
        nome: "Fundo X",
        instituicao: "BTG",
        tipo: "MUTUAL_FUND",
        subtipo: null,
        saldo: 300,
      }),
    ]);

    expect(classes.map((c) => c.nome)).toEqual([
      "Tesouro Direto",
      "Fundo",
      "CDB",
    ]);
  });

  it("pondera a taxa da classe pelo saldo, e ignora quem nao informa", () => {
    const [classe] = agruparPorClasse([
      papel({
        id: "a",
        nome: "CDB A",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 1000,
        taxa: 10,
      }),
      papel({
        id: "b",
        nome: "CDB B",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 3000,
        taxa: 14,
      }),
      papel({
        id: "c",
        nome: "CDB C",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 5000,
        taxa: null,
      }),
    ]);

    // Contar o terceiro como zero daria uma taxa que ninguem contratou.
    expect(classe.taxa).toBeCloseTo(13, 10);
  });

  it("nao transforma lucro desconhecido em zero", () => {
    const [semInfo] = agruparPorClasse([
      papel({
        id: "a",
        nome: "X",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 100,
      }),
    ]);
    expect(semInfo.lucro).toBeNull();

    const [parcial] = agruparPorClasse([
      papel({
        id: "a",
        nome: "X",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 100,
        lucro: 7,
      }),
      papel({
        id: "b",
        nome: "Y",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 200,
      }),
    ]);
    expect(parcial.lucro).toBe(7);
  });

  it("a soma das classes e a soma dos papeis", () => {
    const papeis = [
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 100.55,
      }),
      papel({
        id: "b",
        nome: "NTN-B",
        instituicao: "BTG",
        subtipo: "TREASURY",
        saldo: 900.45,
      }),
      papel({
        id: "c",
        nome: "Fundo",
        instituicao: "XP",
        tipo: "MUTUAL_FUND",
        subtipo: null,
        saldo: 300,
      }),
    ];

    const total = papeis.reduce((s, p) => s + p.saldo, 0);
    expect(
      agruparPorClasse(papeis).reduce((s, c) => s + c.saldo, 0),
    ).toBeCloseTo(total, 10);
  });

  it("sem papel nenhum, nenhuma classe", () => {
    expect(agruparPorClasse([])).toEqual([]);
  });
});

describe("semZerados", () => {
  it("tira o papel resgatado que a instituicao ainda lista", () => {
    const papeis = [
      papel({ id: "vivo", saldo: 100 }),
      papel({ id: "resgatado", saldo: 0 }),
    ];

    expect(semZerados(papeis).map((p) => p.id)).toEqual(["vivo"]);
  });

  it("nao confunde centavo com zero", () => {
    expect(semZerados([papel({ id: "a", saldo: 0.01 })])).toHaveLength(1);
    expect(semZerados([papel({ id: "b", saldo: -0.01 })])).toHaveLength(1);
    expect(semZerados([papel({ id: "c", saldo: 0.001 })])).toHaveLength(0);
  });

  it("mantem saldo negativo, que e um fato e nao um vazio", () => {
    expect(semZerados([papel({ id: "a", saldo: -500 })])).toHaveLength(1);
  });
});

describe("o liquido somado ao lado do bruto", () => {
  it("soma o liquido nos tres niveis", () => {
    // Numeros reais de duas NTN-B no BTG e uma na XP.
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "NTN-B1",
        instituicao: "BTG",
        subtipo: "TREASURY",
        saldo: 108844.23,
        liquido: 107296.2,
      }),
      papel({
        id: "b",
        nome: "NTN-B1",
        instituicao: "BTG",
        subtipo: "TREASURY",
        saldo: 553950.02,
        liquido: 544508.66,
      }),
      papel({
        id: "c",
        nome: "NTN-B1",
        instituicao: "XP",
        subtipo: "TREASURY",
        saldo: 403099.01,
        liquido: 399471.15,
      }),
    ]);

    expect(classes[0].saldo).toBeCloseTo(1065893.26, 2);
    expect(classes[0].liquido).toBeCloseTo(1051276.01, 2);

    const [instrumento] = classes[0].instrumentos;
    expect(instrumento.liquido).toBeCloseTo(1051276.01, 2);

    const btg = instrumento.custodias.find((c) => c.instituicao === "BTG")!;
    expect(btg.liquido).toBeCloseTo(107296.2 + 544508.66, 2);
  });

  it("papel sem liquido informado entra com o bruto", () => {
    // Ativo manual e fundo que a instituicao nao detalha. Subestimar o resgate
    // por falta de informacao seria inventar um imposto que ninguem cobrou.
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "Cripto",
        instituicao: "carteira",
        tipo: "CRYPTO",
        subtipo: null,
        saldo: 300000,
      }),
    ]);

    expect(classes[0].liquido).toBe(300000);
    expect(classes[0].instrumentos[0].liquido).toBe(300000);
    expect(classes[0].instrumentos[0].custodias[0].liquido).toBe(300000);
  });

  it("o liquido nunca passa do bruto", () => {
    const classes = agruparPorClasse([
      papel({
        id: "a",
        nome: "CDB",
        instituicao: "BTG",
        subtipo: "CDB",
        saldo: 3355100.91,
        liquido: 3351855,
      }),
      papel({
        id: "b",
        nome: "Fundo",
        instituicao: "BTG",
        tipo: "MUTUAL_FUND",
        subtipo: null,
        saldo: 14737212.11,
        liquido: 13795630.29,
      }),
      papel({
        id: "c",
        nome: "Manual",
        instituicao: "casa",
        tipo: "CRYPTO",
        subtipo: null,
        saldo: 300000,
      }),
    ]);

    for (const classe of classes) {
      expect(classe.liquido).toBeLessThanOrEqual(classe.saldo);
    }
  });
});

/**
 * O imposto ja retido na fonte, como linha da carteira.
 *
 * Retencao e imposto pago adiantado, nao dinheiro perdido. Os erros que
 * importam aqui sao os dois lados do mesmo engano: somar trimestre que nunca
 * foi pago (inventa credito) e nao somar nada (esconde patrimonio).
 */
describe("creditoDeImpostoRetido", () => {
  it("soma so o que foi pago, numa linha unica", () => {
    const linha = creditoDeImpostoRetido([
      { fonte: "Atmos", pagoEm: "2026-04-13", retido: 73626.62 },
      { fonte: "Atmos", pagoEm: "2026-07-15", retido: 34432.81 },
    ]);

    expect(linha).not.toBeNull();
    expect(linha!.saldo).toBeCloseTo(108059.43, 2);
    expect(linha!.tipo).toBe("TAX_CREDIT");
    expect(linha!.manual).toBe(true);
    expect(linha!.instituicao).toBe("Atmos");
  });

  it("carrega a data do ultimo recebimento, nao a do primeiro", () => {
    const linha = creditoDeImpostoRetido([
      { fonte: "Atmos", pagoEm: "2026-07-15", retido: 34432.81 },
      { fonte: "Atmos", pagoEm: "2026-04-13", retido: 73626.62 },
    ]);

    expect(linha!.avaliadoEm).toBe("2026-07-15");
  });

  it("ignora trimestre apurado sem pagamento", () => {
    const linha = creditoDeImpostoRetido([
      { fonte: "Atmos", pagoEm: null, retido: 50000 },
      { fonte: "Atmos", pagoEm: "2026-04-13", retido: 73626.62 },
    ]);

    expect(linha!.saldo).toBeCloseTo(73626.62, 2);
  });

  it("some quando nada foi retido", () => {
    expect(
      creditoDeImpostoRetido([
        { fonte: "Atmos", pagoEm: "2025-10-13", retido: 0 },
      ]),
    ).toBeNull();
    expect(creditoDeImpostoRetido([])).toBeNull();
  });

  it("nao tenta listar todas as fontes quando ha mais de uma", () => {
    const linha = creditoDeImpostoRetido([
      { fonte: "Atmos", pagoEm: "2026-04-13", retido: 1000 },
      { fonte: "Outra", pagoEm: "2026-05-13", retido: 500 },
    ]);

    expect(linha!.instituicao).toBe("2 fontes");
    expect(linha!.saldo).toBeCloseTo(1500, 2);
  });

  it("entra na carteira como qualquer outro papel", () => {
    const linha = creditoDeImpostoRetido([
      { fonte: "Atmos", pagoEm: "2026-04-13", retido: 73626.62 },
    ])!;

    const classes = agruparPorClasse(semZerados([linha]));
    expect(classes).toHaveLength(1);
    expect(classes[0].nome).toBe("Credito tributario");
    expect(classes[0].saldo).toBeCloseTo(73626.62, 2);
  });
});

/**
 * Remarcar a posicao ao preco oficial do Tesouro.
 *
 * Mexe em patrimonio, entao os numeros abaixo sao os reais da conciliacao: a
 * Renda+ 2065 valia R$ 4.798.476,81 pelos precos das corretoras e
 * R$ 4.744.431,90 pelo Tesouro, com 25.378,08 titulos a 186,95.
 */
describe("remarcarAoPrecoOficial", () => {
  const preco = { taxaCompra: 7.02, precoVenda: 186.95, em: "2026-09-18" };

  const renda: PapelNaCarteira = papel({
    nome: "Renda+ 2065",
    tipo: "FIXED_INCOME",
    subtipo: "TREASURY",
    saldo: 4_798_476.81,
    liquido: 4_705_630.97,
    imposto: 92_845.84,
    aportado: 4_276_317.43,
    taxa: 7.1,
  });

  it("o bruto passa a ser quantidade x preco oficial", () => {
    const novo = remarcarAoPrecoOficial(renda, 25_378.08, preco);
    expect(novo.saldo).toBeCloseTo(4_744_432.06, 2);
    // O que o site do Tesouro mostra, a menos do arredondamento do PU.
    expect(Math.abs(novo.saldo - 4_744_431.9)).toBeLessThan(1);
  });

  it("a taxa da curva substitui a contratada", () => {
    expect(remarcarAoPrecoOficial(renda, 25_378.08, preco).taxa).toBe(7.02);
    expect(remarcarAoPrecoOficial(renda, 25_378.08, preco).precoOficialEm).toBe(
      "2026-09-18",
    );
  });

  // O imposto foi calculado sobre um bruto maior. Copia-lo deixaria o liquido
  // pior que qualquer das duas versoes.
  it("reescala o imposto pelo lucro, preservando a aliquota do lote", () => {
    const novo = remarcarAoPrecoOficial(renda, 25_378.08, preco);
    const aliquotaAntes = 92_845.84 / (4_798_476.81 - 4_276_317.43);
    const aliquotaDepois = novo.imposto! / (novo.saldo - 4_276_317.43);

    expect(aliquotaDepois).toBeCloseTo(aliquotaAntes, 6);
    expect(novo.imposto!).toBeLessThan(92_845.84);
    expect(novo.liquido).toBeCloseTo(novo.saldo - novo.imposto!, 2);
  });

  // O preco sozinho nao diz o tamanho da posicao.
  it("sem quantidade nao remarca nada", () => {
    expect(remarcarAoPrecoOficial(renda, null, preco)).toBe(renda);
    expect(remarcarAoPrecoOficial(renda, 0, preco)).toBe(renda);
    expect(remarcarAoPrecoOficial(renda, -1, preco)).toBe(renda);
  });

  it("sem aportado informado leva o imposto como veio", () => {
    const semAporte = { ...renda, aportado: null };
    const novo = remarcarAoPrecoOficial(semAporte, 25_378.08, preco);
    expect(novo.imposto).toBe(92_845.84);
  });

  it("lucro perto de zero nao vira divisao instavel", () => {
    const noZero = { ...renda, saldo: 4_276_317.44, imposto: 0.01 };
    const novo = remarcarAoPrecoOficial(noZero, 25_378.08, preco);
    expect(Number.isFinite(novo.imposto!)).toBe(true);
    expect(novo.imposto!).toBeGreaterThanOrEqual(0);
  });

  it("nunca produz imposto negativo", () => {
    // Preco oficial abaixo do que foi aportado: a posicao esta no prejuizo.
    const noPrejuizo = remarcarAoPrecoOficial(renda, 25_378.08, {
      ...preco,
      precoVenda: 100,
    });
    expect(noPrejuizo.imposto!).toBe(0);
    expect(noPrejuizo.liquido).toBeCloseTo(noPrejuizo.saldo, 2);
  });
});
