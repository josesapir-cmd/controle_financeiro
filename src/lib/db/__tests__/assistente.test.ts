import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  apagarAnexo,
  ensureSharedBalanceAccount,
  gravarAnexo,
  lancamentoDoSaldoCompartilhado,
  lerAnexo,
  listLancamentosCompartilhados,
  setLabel,
  setTransactionLabel,
  upsertAccount,
  upsertConnection,
  upsertTransactions,
} from "../repository";

/**
 * O recorte da tela da assistente: so o saldo compartilhado sai do banco, e
 * anexo guardado nao fica legivel para quem le o banco.
 */

const ITEM = "22222222-2222-4222-8222-222222222222";

let pg: PGlite;
let db: Db;
let compartilhado: string;
let corrente: string;

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
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

  await upsertConnection(db, { itemId: ITEM, connectorName: "Itau", connectorId: 1 });
  corrente = await upsertAccount(db, {
    itemId: ITEM,
    pluggyAccountId: "33333333-3333-4333-8333-333333333333",
    connectorName: "Itau",
    type: "BANK",
    name: "Conta corrente",
    number: "123",
    balance: 50_000,
  });
  compartilhado = await ensureSharedBalanceAccount(db);

  await upsertTransactions(db, [
    {
      id: "print:1",
      accountId: compartilhado,
      postedAt: "2026-11-20T15:00:00Z",
      localDay: "2026-11-20",
      amount: -42.5,
      description: "PADARIA DO ZE",
      counterpartyKey: "padaria do ze",
      counterpartyName: "PADARIA DO ZE",
      origin: "manual",
    },
    {
      id: "pluggy-1",
      accountId: corrente,
      postedAt: "2026-11-21T15:00:00Z",
      localDay: "2026-11-21",
      amount: -9_000,
      description: "SALARIO DA BABA",
      counterpartyKey: "fulana",
      counterpartyName: "FULANA",
    },
  ] as never);
});

describe("recorte da assistente", () => {
  it("so lancamento do saldo compartilhado passa pela porta", async () => {
    expect(await lancamentoDoSaldoCompartilhado(db, "print:1")).not.toBeNull();
    expect(await lancamentoDoSaldoCompartilhado(db, "pluggy-1")).toBeNull();
    expect(await lancamentoDoSaldoCompartilhado(db, "nao-existe")).toBeNull();
  });

  it("a lista nao traz nada de outra conta", async () => {
    const { lancamentos } = await listLancamentosCompartilhados(db, { limite: 50 });
    expect(lancamentos.map((l) => l.id)).toEqual(["print:1"]);
    expect(JSON.stringify(lancamentos)).not.toContain("SALARIO");
  });

  it("traz o que a tela edita, e some de 'pendentes' quando ganha categoria", async () => {
    const [categoria] = await db.query<{ id: string }>(
      "INSERT INTO categories (name, kind) VALUES ('Teste da assistente', 'despesa') RETURNING id",
    );
    const fp = (await lancamentoDoSaldoCompartilhado(db, "print:1"))!.counterpartyFingerprint!;
    await setLabel(db, fp, { alias: "Padaria da esquina" });
    await setTransactionLabel(db, "print:1", { categoryId: categoria.id, note: "cafe da manha" });

    const { lancamentos } = await listLancamentosCompartilhados(db, { limite: 50 });
    expect(lancamentos[0]).toMatchObject({
      apelido: "Padaria da esquina",
      contraparte: "PADARIA DO ZE",
      categoryId: categoria.id,
      note: "cafe da manha",
    });

    const pendentes = await listLancamentosCompartilhados(db, { limite: 50, soPendentes: true });
    expect(pendentes.lancamentos).toEqual([]);
  });

  it("pagina sem perder o aviso de que ha mais", async () => {
    await upsertTransactions(
      db,
      Array.from({ length: 3 }, (_, i) => ({
        id: `print:extra-${i}`,
        accountId: compartilhado,
        postedAt: "2026-11-10T15:00:00Z",
        localDay: "2026-11-10",
        amount: -1,
        description: `X${i}`,
        origin: "manual",
      })) as never,
    );
    const r = await listLancamentosCompartilhados(db, { limite: 2 });
    expect(r.lancamentos).toHaveLength(2);
    expect(r.haMais).toBe(true);
  });
});

describe("anexos", () => {
  it("guarda cifrado e devolve os mesmos bytes", async () => {
    const conteudo = Buffer.concat([Buffer.from("%PDF-1.7 recibo da padaria do ze"), Buffer.alloc(64, 7)]);
    const id = await gravarAnexo(db, {
      transactionId: "print:1",
      nome: "recibo-padaria.pdf",
      tipo: "application/pdf",
      conteudo,
      criadoPor: "assistente",
    });

    const [cru] = await db.query<{ name_enc: string; content_enc: string }>(
      "SELECT name_enc, content_enc FROM transaction_attachments",
    );
    expect(cru.name_enc).not.toContain("padaria");
    expect(cru.content_enc).not.toContain(conteudo.toString("base64").slice(0, 20));

    const lido = await lerAnexo(db, id);
    expect(lido?.nome).toBe("recibo-padaria.pdf");
    expect(lido?.criadoPor).toBe("assistente");
    expect(Buffer.compare(lido!.conteudo, conteudo)).toBe(0);

    const { lancamentos } = await listLancamentosCompartilhados(db, { limite: 50 });
    expect(lancamentos[0].anexos.map((a) => a.nome)).toEqual(["recibo-padaria.pdf"]);

    await apagarAnexo(db, id);
    expect(await lerAnexo(db, id)).toBeNull();
  });

  it("id que nao e uuid e 'nao encontrado', e nao erro de banco", async () => {
    expect(await lerAnexo(db, "../../etc/passwd")).toBeNull();
  });
});
