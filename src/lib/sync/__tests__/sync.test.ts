import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "@/lib/db/adapter";
import { migrate } from "@/lib/db/migrate.mjs";
import { listAccounts, listTransactions, syncStatus } from "@/lib/db/repository";
import type { Account, Item } from "@/lib/pluggy/types";
import { syncAll, syncConnection, type PluggyGateway } from "../sync";

const ITEM = "11111111-1111-4111-8111-111111111111";
const CONTA_CORRENTE = "22222222-2222-4222-8222-222222222222";
const CARTAO = "33333333-3333-4333-8333-333333333333";
const PERIODO = { from: "2026-08-01", to: "2026-08-31" };

const item: Item = {
  id: ITEM,
  status: "UPDATED",
  createdAt: "2026-08-01T10:00:00Z",
  updatedAt: "2026-08-26T10:00:00Z",
  connector: { id: 823, name: "Inter" },
};

const contas: Account[] = [
  {
    id: CONTA_CORRENTE,
    itemId: ITEM,
    type: "BANK",
    subtype: "CHECKING_ACCOUNT",
    name: "BANCO INTER",
    number: "01212573-3",
    balance: 3153.01,
    currencyCode: "BRL",
  },
  {
    id: CARTAO,
    itemId: ITEM,
    type: "CREDIT",
    subtype: "CREDIT_CARD",
    name: "PLATINUM PRIME",
    number: "2109",
    balance: 1847.32,
    currencyCode: "BRL",
  },
];

function gateway(sobrescrever: Partial<PluggyGateway> = {}): PluggyGateway {
  return {
    getItem: async () => item,
    getAccounts: async () => contas,
    getTransactions: async (accountId) =>
      accountId === CARTAO
        ? [
            {
              // Compra no cartao: a Pluggy devolve positivo porque aumenta a fatura.
              id: "tx-cartao",
              accountId: CARTAO,
              description: "Dois Tes Organicos e L",
              amount: 17.9,
              currencyCode: "BRL",
              date: "2026-08-12T12:17:00.000Z",
              category: "Groceries",
            },
          ]
        : [
            {
              id: "tx-corrente",
              accountId: CONTA_CORRENTE,
              description: "Pix enviado - Maria Locadora",
              amount: -2600,
              currencyCode: "BRL",
              // 23h de Brasilia no dia 5 chega como dia 6 em UTC.
              date: "2026-08-06T02:00:00.000Z",
              category: "Housing",
              paymentData: {
                payer: { documentNumber: { type: "CPF", value: "136.557.127-07" }, name: null },
                receiver: {
                  documentNumber: { type: "CPF", value: "123.456.789-01" },
                  name: "Maria Locadora",
                },
                paymentMethod: "PIX",
              },
            },
          ],
    ...sobrescrever,
  };
}

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  resetKeyCache();

  pg = new PGlite();
  db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };

  await migrate({
    async unsafe(query: string) {
      const r = await pg.exec(query);
      return r[r.length - 1]?.rows ?? [];
    },
  });
});

afterEach(async () => {
  await pg.close();
});

describe("syncConnection", () => {
  it("grava conexao, contas e transacoes", async () => {
    const resultado = await syncConnection(db, gateway(), ITEM, PERIODO);

    expect(resultado).toMatchObject({ connectorName: "Inter", accounts: 2, transactions: 2 });
    expect(await listAccounts(db)).toHaveLength(2);
    expect(await listTransactions(db)).toHaveLength(2);
  });

  // O bug que o usuario encontrou: compra no cartao vem positiva da Pluggy e
  // precisa virar saida antes de qualquer soma.
  it("normaliza o sinal do cartao de credito na escrita", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);

    const [compra] = await listTransactions(db, { from: "2026-08-12", to: "2026-08-12" });
    expect(compra.amount).toBe(-17.9);
  });

  it("resolve o dia no fuso local, nao em UTC", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);

    const [pix] = (await listTransactions(db)).filter((t) => t.id === "tx-corrente");
    expect(pix.localDay).toBe("2026-08-05");
  });

  it("extrai a contraparte e descarta o documento do proprio usuario", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);

    const [pix] = (await listTransactions(db)).filter((t) => t.id === "tx-corrente");
    expect(pix.counterpartyName).toBe("Maria Locadora");
    expect(pix.counterpartyDocument).toBe("12345678901");

    const texto = JSON.stringify(pix.details);
    expect(texto).not.toContain("136.557.127-07");
    expect(texto).toContain("Pix");
  });

  it("registra sucesso na conexao", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);
    const [estado] = await syncStatus(db);
    expect(estado.lastSyncedAt).toBeInstanceOf(Date);
    expect(estado.lastSyncError).toBeNull();
  });

  it("e idempotente: sincronizar duas vezes nao duplica", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);
    await syncConnection(db, gateway(), ITEM, PERIODO);

    expect(await listTransactions(db)).toHaveLength(2);
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it("registra o erro sem lancar quando a Pluggy falha", async () => {
    const resultado = await syncConnection(
      db,
      gateway({
        getAccounts: async () => {
          throw new Error("Pluggy respondeu 504");
        },
      }),
      ITEM,
      PERIODO,
    );

    expect(resultado.error).toBe("Pluggy respondeu 504");
    const [estado] = await syncStatus(db);
    expect(estado.lastSyncError).toBe("Pluggy respondeu 504");
  });

  // Item ilegivel acontece de verdade: uma das conexoes reais responde 404 em
  // GET /items/{id} e mesmo assim entrega contas.
  it("sincroniza mesmo quando o item nao pode ser lido", async () => {
    const resultado = await syncConnection(
      db,
      gateway({
        getItem: async () => {
          throw new Error("item not found");
        },
      }),
      ITEM,
      PERIODO,
    );

    expect(resultado.error).toBeUndefined();
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it("preserva o historico quando a sincronizacao seguinte falha", async () => {
    await syncConnection(db, gateway(), ITEM, PERIODO);
    await syncConnection(
      db,
      gateway({
        getAccounts: async () => {
          throw new Error("conexao caiu");
        },
      }),
      ITEM,
      PERIODO,
    );

    expect(await listTransactions(db)).toHaveLength(2);
  });
});

describe("syncAll", () => {
  it("continua nas demais conexoes quando uma falha", async () => {
    const OUTRO = "44444444-4444-4444-8444-444444444444";

    const resultados = await syncAll(
      db,
      gateway({
        getAccounts: async (itemId: string) => {
          if (itemId === OUTRO) throw new Error("banco fora do ar");
          return contas;
        },
      }),
      [ITEM, OUTRO],
      PERIODO,
    );

    expect(resultados[0].error).toBeUndefined();
    expect(resultados[1].error).toBe("banco fora do ar");
    expect(await listTransactions(db)).toHaveLength(2);
  });
});
