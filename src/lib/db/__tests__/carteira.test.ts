import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  apagarApelidoDeInstrumento,
  arquivarAtivoManual,
  instrumentFingerprint,
  listApelidosDeInstrumento,
  listAtivosManuais,
  listPosicoes,
  salvarApelidoDeInstrumento,
  salvarAtivoManual,
  substituirPosicoes,
  upsertConnection,
} from "../repository";

/**
 * A carteira de investimento que vem da Pluggy.
 *
 * O que se testa aqui e o que erraria calado: um papel resgatado que continua
 * somando no patrimonio, uma re-sincronizacao que duplica a mesma posicao, e a
 * carteira de um banco sendo apagada quando o outro sincroniza.
 */

const BTG = "11111111-1111-1111-1111-111111111111";
const INTER = "33333333-3333-3333-3333-333333333333";

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString("base64");
  resetKeyCache();

  pg = new PGlite();
  db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };

  await migrate(executor);

  await upsertConnection(db, { itemId: BTG, connectorName: "BTG Pactual" });
  await upsertConnection(db, { itemId: INTER, connectorName: "Inter" });
});

afterEach(async () => {
  await pg.close();
});

describe("posicoes de investimento", () => {
  it("guarda o papel com nome e emissor cifrados", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "pos-1",
        itemId: BTG,
        institution: "BTG Pactual",
        type: "FIXED_INCOME",
        subtype: "CDB",
        name: "CDB BTG 2027",
        issuer: "Banco BTG Pactual",
        balance: 120000.5,
        amount: 100000,
        profit: 20000.5,
        annualRate: 0.1325,
        dueDate: "2027-05-10",
        currency: "BRL",
        status: "ACTIVE",
      },
    ]);

    const [cru] = await db.query<{ name_enc: string; issuer_enc: string }>(
      "SELECT name_enc, issuer_enc FROM investments WHERE id = 'pos-1'",
    );
    expect(cru.name_enc).not.toContain("CDB BTG");
    expect(cru.issuer_enc).not.toContain("BTG");

    const [papel] = await listPosicoes(db);
    expect(papel.name).toBe("CDB BTG 2027");
    expect(papel.issuer).toBe("Banco BTG Pactual");
    expect(papel.balance).toBe(120000.5);
    expect(papel.amount).toBe(100000);
    expect(papel.profit).toBe(20000.5);
    expect(papel.annualRate).toBe(0.1325);
    expect(papel.dueDate).toBe("2027-05-10");
    expect(papel.subtype).toBe("CDB");
  });

  it("apaga o papel que sumiu da resposta — resgate nao pode continuar somando", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "pos-1",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 1000,
      },
      {
        id: "pos-2",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 2000,
      },
    ]);

    // A segunda sincronizacao ja nao traz pos-2: o papel foi resgatado.
    await substituirPosicoes(db, BTG, [
      {
        id: "pos-1",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 1100,
      },
    ]);

    const carteira = await listPosicoes(db);
    expect(carteira.map((p) => p.id)).toEqual(["pos-1"]);
    expect(carteira[0].balance).toBe(1100);
  });

  it("nao mexe na carteira das outras conexoes", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "btg-1",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 500,
      },
    ]);
    await substituirPosicoes(db, INTER, [
      {
        id: "inter-1",
        itemId: INTER,
        institution: "Inter",
        type: "MUTUAL_FUND",
        balance: 700,
      },
    ]);

    // Inter sincroniza de novo, sozinha: o papel do BTG segue la.
    await substituirPosicoes(db, INTER, [
      {
        id: "inter-1",
        itemId: INTER,
        institution: "Inter",
        type: "MUTUAL_FUND",
        balance: 750,
      },
    ]);

    const carteira = await listPosicoes(db);
    expect(carteira.map((p) => p.id).sort()).toEqual(["btg-1", "inter-1"]);
  });

  it("esvazia a carteira quando a conexao para de trazer posicao", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "btg-1",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 500,
      },
    ]);

    expect(await substituirPosicoes(db, BTG, [])).toBe(0);
    expect(await listPosicoes(db)).toHaveLength(0);
  });

  it("lista do maior saldo para o menor", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "a",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 10,
      },
      {
        id: "b",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 900,
      },
      {
        id: "c",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 300,
      },
    ]);

    expect((await listPosicoes(db)).map((p) => p.id)).toEqual(["b", "c", "a"]);
  });

  it("aceita papel sem valor informado sem virar zero", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "sem-lucro",
        itemId: BTG,
        institution: "BTG",
        type: "MUTUAL_FUND",
        balance: 1000,
      },
    ]);

    const [papel] = await listPosicoes(db);
    expect(papel.profit).toBeNull();
    expect(papel.amount).toBeNull();
    expect(papel.annualRate).toBeNull();
    expect(papel.dueDate).toBeNull();
  });
});

describe("ativos manuais", () => {
  it("guarda o nome e a nota cifrados", async () => {
    const id = await salvarAtivoManual(db, {
      name: "Green FIDC Solar GD",
      institution: "Oliveira Trust",
      type: "FIXED_INCOME",
      subtype: "FIDC",
      balance: 377098.98,
      annualRate: 11,
      valuedAt: "2025-12-31",
      note: "informe de rendimentos 2025",
    });

    const [cru] = await db.query<{ name_enc: string; note_enc: string }>(
      "SELECT name_enc, note_enc FROM manual_investments WHERE id = $1",
      [id],
    );
    expect(cru.name_enc).not.toContain("Green");
    expect(cru.note_enc).not.toContain("informe");

    const [ativo] = await listAtivosManuais(db);
    expect(ativo.name).toBe("Green FIDC Solar GD");
    expect(ativo.note).toBe("informe de rendimentos 2025");
    expect(ativo.balance).toBe(377098.98);
    expect(ativo.valuedAt).toBe("2025-12-31");
    expect(ativo.institution).toBe("Oliveira Trust");
  });

  it("aceita ativo sem custodiante, que e o caso da cripto em carteira propria", async () => {
    await salvarAtivoManual(db, {
      name: "Fade to Space",
      type: "CRYPTO",
      balance: 300000,
      valuedAt: "2026-09-16",
    });

    const [ativo] = await listAtivosManuais(db);
    expect(ativo.institution).toBeNull();
    expect(ativo.balance).toBe(300000);
  });

  it("nao grava sem nome, sem valor ou sem data de apuracao", async () => {
    const base = { type: "CRYPTO", balance: 1, valuedAt: "2026-09-16" };

    expect(await salvarAtivoManual(db, { ...base, name: "   " })).toBeNull();
    expect(
      await salvarAtivoManual(db, { ...base, name: "x", balance: NaN }),
    ).toBeNull();
    expect(
      await salvarAtivoManual(db, { ...base, name: "x", valuedAt: "" }),
    ).toBeNull();
    expect(await listAtivosManuais(db)).toHaveLength(0);
  });

  it("atualiza sem criar uma segunda linha", async () => {
    const id = await salvarAtivoManual(db, {
      name: "Fade to Space",
      type: "CRYPTO",
      balance: 300000,
      valuedAt: "2026-09-16",
    });

    await salvarAtivoManual(
      db,
      {
        name: "Fade to Space",
        type: "CRYPTO",
        balance: 312500,
        valuedAt: "2026-10-01",
      },
      id!,
    );

    const ativos = await listAtivosManuais(db);
    expect(ativos).toHaveLength(1);
    expect(ativos[0].balance).toBe(312500);
    expect(ativos[0].valuedAt).toBe("2026-10-01");
  });

  it("nao junta dois ativos de mesmo nome — podem ser dois de verdade", async () => {
    const base = {
      name: "Apartamento",
      type: "REAL_ESTATE",
      valuedAt: "2026-01-01",
    };
    await salvarAtivoManual(db, {
      ...base,
      balance: 1200000,
      institution: "Sao Paulo",
    });
    await salvarAtivoManual(db, {
      ...base,
      balance: 800000,
      institution: "Campos do Jordao",
    });

    expect(await listAtivosManuais(db)).toHaveLength(2);
  });

  it("arquivado some da lista mas continua no banco", async () => {
    const id = await salvarAtivoManual(db, {
      name: "Vendido",
      type: "CRYPTO",
      balance: 50000,
      valuedAt: "2026-01-01",
    });

    await arquivarAtivoManual(db, id!);

    expect(await listAtivosManuais(db)).toHaveLength(0);
    const [linha] = await db.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM manual_investments",
    );
    expect(linha.n).toBe("1");
  });
});

describe("apelido de instrumento", () => {
  it("une nomes que nenhuma regra de texto juntaria", async () => {
    // O caso real: a mesma NTN-B Renda+ 2065 chega com quatro nomes, um por
    // custodia. Aparar espaco e baixar caixa nao aproxima "NTN-B1" de
    // "Tesouro Renda+ Aposentadoria Extra 2065".
    const nomes = [
      "Tesouro Renda+ Aposentadoria Extra 2065",
      "Tesouro RendA+ 2065",
      "NTN-B1",
      "TESOURO DIRETO - NTN-B1",
    ];

    for (const nome of nomes) {
      await salvarApelidoDeInstrumento(db, nome, "Renda+ 2065");
    }

    const apelidos = await listApelidosDeInstrumento(db);
    expect(apelidos).toHaveLength(4);
    expect(new Set(apelidos.map((a) => a.alias))).toEqual(
      new Set(["Renda+ 2065"]),
    );
    // Os quatro caem no mesmo fingerprint de apelido, que e o que os une.
    const [linha] = await db.query<{ n: string }>(
      "SELECT count(DISTINCT alias_fingerprint)::text AS n FROM instrument_aliases",
    );
    expect(linha.n).toBe("1");
  });

  it("guarda o nome cru para a tela poder mostrar o que foi unido", async () => {
    await salvarApelidoDeInstrumento(db, "NTN-B1", "Renda+ 2065");

    const [apelido] = await listApelidosDeInstrumento(db);
    expect(apelido.rawName).toBe("NTN-B1");
    expect(apelido.alias).toBe("Renda+ 2065");
  });

  it("nao guarda nome em claro", async () => {
    await salvarApelidoDeInstrumento(db, "NTN-B1", "Renda+ 2065");

    const [cru] = await db.query<{ alias_enc: string; raw_name_enc: string }>(
      "SELECT alias_enc, raw_name_enc FROM instrument_aliases",
    );
    expect(cru.alias_enc).not.toContain("Renda");
    expect(cru.raw_name_enc).not.toContain("NTN");
  });

  it("declarar de novo troca o apelido em vez de duplicar", async () => {
    await salvarApelidoDeInstrumento(db, "NTN-B1", "Renda+ 2065");
    await salvarApelidoDeInstrumento(
      db,
      "NTN-B1",
      "Renda+ 2065 (aposentadoria)",
    );

    const apelidos = await listApelidosDeInstrumento(db);
    expect(apelidos).toHaveLength(1);
    expect(apelidos[0].alias).toBe("Renda+ 2065 (aposentadoria)");
  });

  it("o fingerprint ignora caixa e espaco nas pontas", async () => {
    expect(instrumentFingerprint("  NTN-B1  ")).toBe(
      instrumentFingerprint("ntn-b1"),
    );
  });

  it("separar devolve o papel para si mesmo", async () => {
    await salvarApelidoDeInstrumento(db, "NTN-B1", "Renda+ 2065");
    await apagarApelidoDeInstrumento(db, "NTN-B1");

    expect(await listApelidosDeInstrumento(db)).toHaveLength(0);
  });

  it("nao aceita declaracao pela metade", async () => {
    await salvarApelidoDeInstrumento(db, "   ", "Renda+ 2065");
    await salvarApelidoDeInstrumento(db, "NTN-B1", "  ");

    expect(await listApelidosDeInstrumento(db)).toHaveLength(0);
  });
});

describe("bruto, liquido e o que a Pluggy manda junto", () => {
  it("guarda bruto e liquido separados, e a tela soma o bruto", async () => {
    // Numeros reais de uma NTN-B1 no BTG: a conta da Pluggy fecha ao centavo.
    await substituirPosicoes(db, BTG, [
      {
        id: "ntnb",
        itemId: BTG,
        institution: "BTG Pactual",
        type: "FIXED_INCOME",
        subtype: "TREASURY",
        balance: 107296.2,
        gross: 108844.23,
        taxes: 1548.03,
        quantity: 575.53,
        unitPrice: 189.119994,
        amount: 99998.3375,
        profit: 8845.8925,
        annualRate: 7.02,
        indexPercent: 100,
      },
    ]);

    const [posicao] = await listPosicoes(db);
    expect(posicao.gross).toBe(108844.23);
    expect(posicao.balance).toBe(107296.2);
    expect(posicao.taxes).toBe(1548.03);
    // A regra que da sentido aos dois nomes enganosos.
    expect(posicao.gross! - posicao.taxes!).toBeCloseTo(posicao.balance, 2);
    // E o bruto e a quantidade vezes o preco unitario.
    expect(posicao.quantity! * posicao.unitPrice!).toBeCloseTo(
      posicao.gross!,
      2,
    );
  });

  it("a taxa contratada vence a generica, que vem nula em renda fixa", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "a",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 100,
        annualRate: 7.02,
      },
    ]);

    // O repositorio grava `annualRate` na coluna da contratada e a le de volta
    // dali: era a leitura de `annual_rate` que deixava o Tesouro sem taxa.
    const [posicao] = await listPosicoes(db);
    expect(posicao.annualRate).toBe(7.02);
  });

  // O CDB atrelado ao CDI chega com taxa fixa 0 e o indexador em 102: a taxa
  // dele existe, so nao e um numero fixo. Deixar o 0 passar exibia "0,00% ao
  // ano" — uma afirmacao falsa — e ainda zerava a media da classe inteira.
  it("taxa zero e campo em branco, nao rendimento nulo", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "cdb-cdi",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        subtype: "CDB",
        balance: 100,
        annualRate: 0,
        indexPercent: 102,
      },
    ]);

    const [posicao] = await listPosicoes(db);
    expect(posicao.annualRate).toBeNull();
    // O indexador continua la: e onde a remuneracao desse papel mora.
    expect(posicao.indexPercent).toBe(102);
  });

  it("ordena pelo bruto, e nao pelo liquido", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "menor-liquido",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 90,
        gross: 200,
      },
      {
        id: "maior-liquido",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 100,
        gross: 110,
      },
    ]);

    expect((await listPosicoes(db)).map((p) => p.id)).toEqual([
      "menor-liquido",
      "maior-liquido",
    ]);
  });

  it("sem bruto informado, o liquido ainda ordena", async () => {
    await substituirPosicoes(db, BTG, [
      {
        id: "a",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 50,
      },
      {
        id: "b",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 500,
      },
    ]);

    expect((await listPosicoes(db)).map((p) => p.id)).toEqual(["b", "a"]);
  });

  it("zero em imposto nao vira nulo por engano", async () => {
    // O Tesouro manda taxes2 = 0; somar 0 + 0 e um numero, nao uma ausencia.
    await substituirPosicoes(db, BTG, [
      {
        id: "a",
        itemId: BTG,
        institution: "BTG",
        type: "FIXED_INCOME",
        balance: 100,
        gross: 100,
        taxes: 0,
      },
    ]);

    const [posicao] = await listPosicoes(db);
    expect(posicao.taxes).toBe(0);
  });
});
