import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  accountFingerprint,
  listAccounts,
  listLabels,
  listTransactions,
  markSync,
  setLabel,
  syncStatus,
  upsertAccount,
  upsertConnection,
  upsertTransactions,
} from "../repository";

const ITEM = "11111111-1111-4111-8111-111111111111";

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  resetKeyCache();

  pg = new PGlite();
  db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };

  await migrate({
    async unsafe(query: string) {
      const resultado = await pg.exec(query);
      return resultado[resultado.length - 1]?.rows ?? [];
    },
  });

  await upsertConnection(db, { itemId: ITEM, connectorName: "Inter", connectorId: 823 });
});

afterEach(async () => {
  await pg.close();
});

async function contaExemplo(numero = "01212573-3") {
  return upsertAccount(db, {
    itemId: ITEM,
    pluggyAccountId: "22222222-2222-4222-8222-222222222222",
    connectorName: "Inter",
    type: "BANK",
    name: "BANCO INTER",
    number: numero,
    balance: 3153.01,
  });
}

describe("contas", () => {
  it("grava e devolve com os campos decifrados", async () => {
    await contaExemplo();
    const [conta] = await listAccounts(db);

    expect(conta.name).toBe("BANCO INTER");
    expect(conta.number).toBe("01212573-3");
    expect(conta.balance).toBeCloseTo(3153.01, 2);
  });

  // O nome e o numero da conta nao podem estar legiveis no banco: e o ponto
  // inteiro da criptografia na aplicacao.
  it("nao guarda nome nem numero em claro", async () => {
    await contaExemplo();
    const { rows } = await pg.query<{ name_enc: string; number_enc: string }>(
      "SELECT name_enc, number_enc FROM accounts",
    );

    expect(rows[0].name_enc).not.toContain("INTER");
    expect(rows[0].number_enc).not.toContain("01212573");
    expect(rows[0].name_enc.startsWith("v1.")).toBe(true);
  });

  it("atualiza a mesma conta em vez de duplicar", async () => {
    const primeiro = await contaExemplo();
    const segundo = await contaExemplo();

    expect(segundo).toBe(primeiro);
    expect(await listAccounts(db)).toHaveLength(1);
  });

  // A promessa central da persistencia: reconectar um banco gera itemId novo,
  // e a conta precisa continuar sendo a mesma.
  it("mantem a identidade quando a conexao e recriada", async () => {
    const antes = await contaExemplo();

    const novoItem = "99999999-9999-4999-8999-999999999999";
    await upsertConnection(db, { itemId: novoItem, connectorName: "Inter" });
    const depois = await upsertAccount(db, {
      itemId: novoItem,
      pluggyAccountId: "33333333-3333-4333-8333-333333333333",
      connectorName: "Inter",
      type: "BANK",
      name: "BANCO INTER",
      number: "01212573-3",
      balance: 3200,
    });

    expect(depois).toBe(antes);
    expect(await listAccounts(db)).toHaveLength(1);
  });

  it("distingue contas diferentes da mesma instituicao", async () => {
    await contaExemplo("01212573-3");
    await contaExemplo("00099999-1");
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it("produz fingerprints diferentes para contas distintas", () => {
    expect(accountFingerprint("BANCO INTER", "123", "CHECKING_ACCOUNT")).not.toBe(
      accountFingerprint("Nu Pagamentos", "123", "CHECKING_ACCOUNT"),
    );
  });

  // Caso real: no BTG, duas contas correntes distintas tem o mesmo numero.
  it("distingue contas de mesmo numero pelo nome", async () => {
    await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "44444444-4444-4444-8444-444444444444",
      connectorName: "BTG", type: "BANK", subtype: "CHECKING_ACCOUNT",
      name: "BTG Pactual WM", number: "00028026-9", balance: 0.44,
    });
    await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "55555555-5555-4555-8555-555555555555",
      connectorName: "BTG", type: "BANK", subtype: "CHECKING_ACCOUNT",
      name: "BTG Banking", number: "00028026-9", balance: 1960,
    });

    expect(await listAccounts(db)).toHaveLength(2);
  });

  // A identidade nao pode depender do nome da instituicao: ele vem do item, e
  // ha conexoes que respondem 404 nele enquanto entregam contas.
  it("mantem a identidade quando o nome da instituicao muda", async () => {
    const antes = await contaExemplo();
    const depois = await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "22222222-2222-4222-8222-222222222222",
      connectorName: "(desconhecido)", type: "BANK",
      name: "BANCO INTER", number: "01212573-3", balance: 3153.01,
    });

    expect(depois).toBe(antes);
  });
});

describe("transacoes", () => {
  it("grava e devolve decifrado", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      {
        id: "tx-1",
        accountId,
        postedAt: "2026-08-26T18:19:21.000Z",
        localDay: "2026-08-26",
        amount: -45000,
        category: "Investments",
        description: "Aplicacao - Cdb Pos Di Liq",
        counterpartyKey: "12345678901",
        counterpartyName: "Maria Locadora",
        counterpartyDocument: "12345678901",
        details: [{ label: "Meio", value: "Pix" }],
      },
    ]);

    const [t] = await listTransactions(db);
    expect(t.description).toBe("Aplicacao - Cdb Pos Di Liq");
    expect(t.counterpartyName).toBe("Maria Locadora");
    expect(t.details).toEqual([{ label: "Meio", value: "Pix" }]);
    expect(t.amount).toBe(-45000);
    expect(t.localDay).toBe("2026-08-26");
  });

  it("nao guarda descricao nem contraparte em claro", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      {
        id: "tx-2",
        accountId,
        postedAt: "2026-08-26T18:19:21.000Z",
        localDay: "2026-08-26",
        amount: -100,
        description: "Supermercado Pao de Acucar",
        counterpartyName: "Padaria Central",
      },
    ]);

    const { rows } = await pg.query<{ description_enc: string; counterparty_name_enc: string }>(
      "SELECT description_enc, counterparty_name_enc FROM transactions",
    );
    expect(rows[0].description_enc).not.toContain("Supermercado");
    expect(rows[0].counterparty_name_enc).not.toContain("Padaria");
  });

  // Re-sincronizar o mesmo periodo precisa atualizar, nao duplicar.
  it("e idempotente pelo id da Pluggy", async () => {
    const accountId = await contaExemplo();
    const base = {
      id: "tx-3",
      accountId,
      postedAt: "2026-08-26T12:00:00.000Z",
      localDay: "2026-08-26",
      amount: -10,
    };

    await upsertTransactions(db, [base]);
    await upsertTransactions(db, [{ ...base, amount: -20 }]);

    const todas = await listTransactions(db);
    expect(todas).toHaveLength(1);
    expect(todas[0].amount).toBe(-20);
  });

  it("preserva first_seen_at ao reprocessar", async () => {
    const accountId = await contaExemplo();
    const base = {
      id: "tx-4",
      accountId,
      postedAt: "2026-08-26T12:00:00.000Z",
      localDay: "2026-08-26",
      amount: -10,
    };

    await upsertTransactions(db, [base]);
    const antes = (await pg.query<{ first_seen_at: string }>("SELECT first_seen_at FROM transactions"))
      .rows[0].first_seen_at;

    await upsertTransactions(db, [{ ...base, amount: -30 }]);
    const depois = (await pg.query<{ first_seen_at: string }>("SELECT first_seen_at FROM transactions"))
      .rows[0].first_seen_at;

    expect(String(depois)).toBe(String(antes));
  });

  it("filtra por periodo", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "a", accountId, postedAt: "2026-07-20T12:00:00Z", localDay: "2026-07-20", amount: -1 },
      { id: "b", accountId, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -2 },
      { id: "c", accountId, postedAt: "2026-09-02T12:00:00Z", localDay: "2026-09-02", amount: -3 },
    ]);

    const agosto = await listTransactions(db, { from: "2026-08-01", to: "2026-08-31" });
    expect(agosto.map((t) => t.id)).toEqual(["b"]);
  });

  it("filtra por conta", async () => {
    const conta1 = await contaExemplo("111-1");
    const conta2 = await contaExemplo("222-2");
    await upsertTransactions(db, [
      { id: "a", accountId: conta1, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -1 },
      { id: "b", accountId: conta2, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -2 },
    ]);

    const so1 = await listTransactions(db, { accountIds: [conta1] });
    expect(so1.map((t) => t.id)).toEqual(["a"]);
  });

  // Chave de agrupamento precisa ser deterministica, senao a aba de
  // contrapartes nao consegue somar por pessoa.
  it("gera o mesmo fingerprint de contraparte para o mesmo documento", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "a", accountId, postedAt: "2026-08-01T12:00:00Z", localDay: "2026-08-01", amount: -1, counterpartyKey: "12345678901" },
      { id: "b", accountId, postedAt: "2026-08-02T12:00:00Z", localDay: "2026-08-02", amount: -2, counterpartyKey: "12345678901" },
    ]);

    const [x, y] = await listTransactions(db);
    expect(x.counterpartyFingerprint).toBe(y.counterpartyFingerprint);
    expect(x.counterpartyFingerprint).not.toContain("12345678901");
  });
});

describe("rotulos de contraparte", () => {
  it("grava e devolve com o apelido decifrado", async () => {
    await setLabel(db, "fp-contraparte", {
      category: "Viagem",
      subcategory: "Viagem FDS Familia",
      alias: "Hotel Fazenda Cascatinha",
    });

    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBe("Viagem");
    expect(rotulo.alias).toBe("Hotel Fazenda Cascatinha");
  });

  it("nao guarda o apelido em claro", async () => {
    await setLabel(db, "fp-contraparte", { alias: "Hotel Fazenda Cascatinha" });
    const { rows } = await pg.query<{ alias_enc: string }>("SELECT alias_enc FROM counterparty_labels");
    expect(rows[0].alias_enc).not.toContain("Cascatinha");
  });

  it("apaga o registro quando todos os campos ficam vazios", async () => {
    await setLabel(db, "fp-contraparte", { category: "Viagem" });
    await setLabel(db, "fp-contraparte", { category: "", subcategory: "", alias: "" });
    expect(await listLabels(db)).toHaveLength(0);
  });
});

describe("estado de sincronizacao", () => {
  it("registra sucesso e erro por conexao", async () => {
    await markSync(db, ITEM, null);
    const [ok] = await syncStatus(db);
    expect(ok.lastSyncedAt).toBeInstanceOf(Date);
    expect(ok.lastSyncError).toBeNull();

    await markSync(db, ITEM, "Pluggy respondeu 504");
    const [erro] = await syncStatus(db);
    expect(erro.lastSyncError).toBe("Pluggy respondeu 504");
  });
});

describe("remocao de conexao", () => {
  /**
   * O comportamento que o usuario vai exercitar ao trocar de banco: tirar a
   * conexao precisa manter o historico e parar de contar o saldo.
   */
  it("arquiva as contas mas preserva as transacoes", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "tx-hist", accountId, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -123 },
    ]);

    await db.query("DELETE FROM connections WHERE item_id = $1", [ITEM]);

    // Fora do patrimonio: o saldo congelado mentiria.
    expect(await listAccounts(db)).toHaveLength(0);
    // Historico intacto: transacoes sao fatos passados.
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("reconectar a mesma conta a desarquiva", async () => {
    await contaExemplo();
    await db.query("DELETE FROM connections WHERE item_id = $1", [ITEM]);
    expect(await listAccounts(db)).toHaveLength(0);

    const novoItem = "77777777-7777-4777-8777-777777777777";
    await upsertConnection(db, { itemId: novoItem, connectorName: "XP" });
    await upsertAccount(db, {
      itemId: novoItem,
      pluggyAccountId: "88888888-8888-4888-8888-888888888888",
      connectorName: "XP",
      type: "BANK",
      name: "BANCO INTER",
      number: "01212573-3",
      balance: 4000,
    });

    const [conta] = await listAccounts(db);
    expect(conta.balance).toBe(4000);
  });
});

describe("identidade nao depende do nome de exibicao", () => {
  /**
   * O marketingName aparece e some entre sincronizacoes. Quando ele entrava na
   * identidade, reconectar um banco criava uma conta nova e partia o historico
   * — foi o que aconteceu com a conta corrente do Nubank.
   */
  it("mantem a mesma conta quando so o nome de exibicao muda", async () => {
    const primeiro = await upsertAccount(db, {
      itemId: ITEM,
      pluggyAccountId: "66666666-6666-4666-8666-666666666666",
      connectorName: "Nubank",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      identityName: "Nu Pagamentos S.A.",
      name: "Nu Pagamentos S.A.",
      number: "09693994-9",
      balance: 100,
    });

    const segundo = await upsertAccount(db, {
      itemId: ITEM,
      pluggyAccountId: "66666666-6666-4666-8666-666666666666",
      connectorName: "Nubank",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      identityName: "Nu Pagamentos S.A.",
      // Nome de exibicao diferente, vindo do marketingName.
      name: "Conta do Nu",
      number: "09693994-9",
      balance: 150,
    });

    expect(segundo).toBe(primeiro);
    expect(await listAccounts(db)).toHaveLength(1);
  });
});
