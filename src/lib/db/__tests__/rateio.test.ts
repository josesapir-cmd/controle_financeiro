import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  acharOuCriarCategoria,
  debtorFingerprint,
  listPartesDaDespesa,
  salvarRateio,
  upsertAccount,
  upsertConnection,
  upsertTransactions,
} from "../repository";

/**
 * A despesa dividida em partes.
 *
 * O que pode dar errado em silencio: uma edicao que soma partes novas as
 * antigas (a despesa passaria a valer o dobro) e o nome do devedor indo em
 * claro para o banco.
 */

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 31).toString("base64");
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

  const contaId = await upsertAccount(db, {
    itemId: "11111111-1111-1111-1111-111111111111",
    pluggyAccountId: "22222222-2222-2222-2222-222222222222",
    connectorName: "Itau",
    type: "CREDIT",
    subtype: "CREDIT_CARD",
    name: "Cartao",
    balance: 0,
  });

  await upsertTransactions(db, [
    {
      id: "t1",
      accountId: contaId,
      postedAt: new Date("2026-09-14T15:00:00Z"),
      localDay: "2026-09-14",
      amount: -600,
      description: "RESTAURANTE",
    },
  ]);
});

afterEach(async () => {
  await pg.close();
});

describe("rateio da despesa", () => {
  it("guarda as partes com categoria e devedor", async () => {
    const alimentacao = (await acharOuCriarCategoria(db, "Alimentacao"))!;
    const reembolso = (await acharOuCriarCategoria(db, "A reembolsar"))!;

    await salvarRateio(db, "t1", [
      { amount: 100, categoryId: alimentacao },
      { amount: 500, categoryId: reembolso, owedBy: "Turma do almoco" },
    ]);

    const partes = await listPartesDaDespesa(db, ["t1"]);
    expect(partes.map((p) => p.amount)).toEqual([100, 500]);
    expect(partes[0].owedBy).toBeNull();
    expect(partes[1].owedBy).toBe("Turma do almoco");
    expect(partes[1].categoryId).toBe(reembolso);
  });

  it("regravar substitui a divisao inteira, em vez de somar a antiga", async () => {
    // Somar faria a despesa de 600 passar a valer 1200 sem ninguem pedir.
    const cat = (await acharOuCriarCategoria(db, "Alimentacao"))!;

    await salvarRateio(db, "t1", [{ amount: 300, categoryId: cat }, { amount: 300, categoryId: cat }]);
    await salvarRateio(db, "t1", [{ amount: 600, categoryId: cat }]);

    const partes = await listPartesDaDespesa(db, ["t1"]);
    expect(partes).toHaveLength(1);
    expect(partes[0].amount).toBe(600);
  });

  it("lista vazia desfaz a divisao", async () => {
    const cat = (await acharOuCriarCategoria(db, "Alimentacao"))!;
    await salvarRateio(db, "t1", [{ amount: 600, categoryId: cat }]);

    await salvarRateio(db, "t1", []);
    expect(await listPartesDaDespesa(db, ["t1"])).toHaveLength(0);
  });

  it("o nome do devedor nao vai em claro para o banco", async () => {
    await salvarRateio(db, "t1", [{ amount: 600, owedBy: "Maria Silva" }]);

    const cru = await db.query<{ owed_by_enc: string; owed_by_fp: string }>(
      "SELECT owed_by_enc, owed_by_fp FROM transaction_splits",
    );

    expect(cru[0].owed_by_enc).not.toContain("Maria");
    expect(cru[0].owed_by_fp).toBe(debtorFingerprint("Maria Silva"));
  });

  it("o mesmo devedor da o mesmo fingerprint, ignorando caixa e espaco", async () => {
    // E o que vai permitir somar "quanto fulano me deve" sem decifrar tudo.
    expect(debtorFingerprint("Maria Silva")).toBe(debtorFingerprint("  maria silva  "));
  });

  it("ignora parte com valor zero ou negativo", async () => {
    await salvarRateio(db, "t1", [{ amount: 600 }, { amount: 0 }, { amount: -10 }]);
    expect(await listPartesDaDespesa(db, ["t1"])).toHaveLength(1);
  });

  it("apagar a transacao leva junto as partes", async () => {
    await salvarRateio(db, "t1", [{ amount: 600 }]);
    await db.query("DELETE FROM transactions WHERE id = $1", ["t1"]);

    expect(await listPartesDaDespesa(db)).toHaveLength(0);
  });

  it("preserva a ordem em que as partes foram informadas", async () => {
    await salvarRateio(db, "t1", [
      { amount: 100, owedBy: "Ana" },
      { amount: 200, owedBy: "Bruno" },
      { amount: 300, owedBy: "Carla" },
    ]);

    expect((await listPartesDaDespesa(db, ["t1"])).map((p) => p.owedBy)).toEqual([
      "Ana",
      "Bruno",
      "Carla",
    ]);
  });
});
