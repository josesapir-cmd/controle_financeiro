import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  arquivarAtivoManual,
  listAtivosManuais,
  listPosicoes,
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
