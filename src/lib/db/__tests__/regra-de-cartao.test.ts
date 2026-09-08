import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  acharOuCriarCategoria,
  apagarRegraDeCartao,
  listRegrasDeCartao,
  salvarRegraDeCartao,
  upsertAccount,
  upsertConnection,
} from "../repository";

/**
 * A regra que manda todo gasto de um cartao para uma categoria.
 *
 * O que pode dar errado em silencio: duas regras para o mesmo plastico (o
 * resultado passaria a depender da ordem da consulta) e uma regra vazia
 * sobrevivendo depois de ter o conteudo apagado.
 */

let pg: PGlite;
let db: Db;
let contaId: string;

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

  await upsertConnection(db, {
    itemId: "11111111-1111-1111-1111-111111111111",
    connectorId: 1,
    connectorName: "Itau",
    status: "UPDATED",
  });

  contaId = await upsertAccount(db, {
    itemId: "11111111-1111-1111-1111-111111111111",
    pluggyAccountId: "22222222-2222-2222-2222-222222222222",
    connectorName: "Itau",
    type: "CREDIT",
    subtype: "CREDIT_CARD",
    name: "PERSONNALITE MC BLACK",
    number: "9379",
    balance: 0,
    currency: "BRL",
  });
});

afterEach(async () => {
  await pg.close();
});

describe("regra por cartao", () => {
  it("guarda a categoria de um cartao", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Presentes, doacoes e transferencias"))!;

    await salvarRegraDeCartao(db, {
      accountId: contaId,
      cardNumber: "2797",
      categoryId: categoria,
      label: "Cartao do pai",
    });

    const [regra] = await listRegrasDeCartao(db);
    expect(regra.cardNumber).toBe("2797");
    expect(regra.categoryId).toBe(categoria);
    expect(regra.label).toBe("Cartao do pai");
  });

  it("um cartao tem uma regra so: gravar de novo substitui", async () => {
    // Duas linhas para o mesmo plastico fariam o resultado depender da ordem
    // da consulta — o tipo de erro que so aparece meses depois.
    const primeira = (await acharOuCriarCategoria(db, "Compras"))!;
    const segunda = (await acharOuCriarCategoria(db, "Saude"))!;

    await salvarRegraDeCartao(db, {
      accountId: contaId,
      cardNumber: "2797",
      categoryId: primeira,
    });
    await salvarRegraDeCartao(db, {
      accountId: contaId,
      cardNumber: "2797",
      categoryId: segunda,
    });

    const regras = await listRegrasDeCartao(db);
    expect(regras).toHaveLength(1);
    expect(regras[0].categoryId).toBe(segunda);
  });

  it("cartoes diferentes convivem na mesma conta", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;

    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "2797", categoryId: categoria });
    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "8228", categoryId: categoria });

    expect((await listRegrasDeCartao(db)).map((r) => r.cardNumber)).toEqual(["2797", "8228"]);
  });

  it("regra sem categoria, sem centro e sem apelido deixa de existir", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "2797", categoryId: categoria });

    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "2797" });

    expect(await listRegrasDeCartao(db)).toHaveLength(0);
  });

  it("apagar a conta leva junto as regras dela", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "2797", categoryId: categoria });

    await db.query("DELETE FROM accounts WHERE id = $1", [contaId]);

    expect(await listRegrasDeCartao(db)).toHaveLength(0);
  });

  it("apagar a categoria leva junto a regra que dependia dela", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "2797", categoryId: categoria });

    await db.query("DELETE FROM categories WHERE id = $1", [categoria]);

    // Melhor sumir do que apontar para uma categoria que nao existe mais.
    expect(await listRegrasDeCartao(db)).toHaveLength(0);
  });

  it("ignora id que nem uuid e, e cartao vazio", async () => {
    await salvarRegraDeCartao(db, { accountId: "abc", cardNumber: "2797", label: "x" });
    await salvarRegraDeCartao(db, { accountId: contaId, cardNumber: "   ", label: "x" });
    await apagarRegraDeCartao(db, "abc", "2797");

    expect(await listRegrasDeCartao(db)).toHaveLength(0);
  });
});
