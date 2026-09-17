import { describe, expect, it } from "vitest";
import {
  agrupar,
  agruparPapeis,
  classeDoPapel,
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

describe("agrupar", () => {
  const papeis = [
    papel({ id: "a", subtipo: "CDB", saldo: 1000 }),
    papel({ id: "b", subtipo: "CDB", saldo: 500 }),
    papel({ id: "c", subtipo: "TREASURY", saldo: 3000 }),
    papel({
      id: "d",
      tipo: "MUTUAL_FUND",
      subtipo: "MULTIMARKET_FUND",
      saldo: 200,
    }),
  ];

  it("soma saldo e conta papeis por classe", () => {
    const grupos = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));

    expect(grupos).toEqual([
      { nome: "Tesouro Direto", total: 3000, papeis: 1 },
      { nome: "CDB", total: 1500, papeis: 2 },
      { nome: "Fundo multimercado", total: 200, papeis: 1 },
    ]);
  });

  it("ordena do maior total para o menor", () => {
    const grupos = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));
    expect(grupos.map((g) => g.total)).toEqual([3000, 1500, 200]);
  });

  it("nao perde nem duplica saldo: a soma dos grupos e a soma dos papeis", () => {
    const porClasse = agrupar(papeis, (p) => classeDoPapel(p.tipo, p.subtipo));
    const porInstituicao = agrupar(papeis, (p) => p.instituicao);
    const total = papeis.reduce((s, p) => s + p.saldo, 0);

    expect(porClasse.reduce((s, g) => s + g.total, 0)).toBe(total);
    expect(porInstituicao.reduce((s, g) => s + g.total, 0)).toBe(total);
    expect(porInstituicao).toHaveLength(1);
  });

  it("nao inventa grupo quando nao ha papel", () => {
    expect(agrupar([], (p) => p.instituicao)).toEqual([]);
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
