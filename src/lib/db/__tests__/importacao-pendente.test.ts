import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it } from "vitest";
import { migrate, type Executor } from "@/lib/db/migrate.mjs";
import { fromPostgres } from "@/lib/db/adapter";
import { resetKeyCache } from "@/lib/crypto";
import { criarImportacao, lerImportacao, listarImportacoes } from "@/lib/db/repository";

let pg: PGlite;

function executor(db: PGlite): Executor {
  return {
    async unsafe(query: string) {
      const resultado = await db.exec(query);
      return resultado[resultado.length - 1]?.rows ?? [];
    },
  };
}

function adaptador(db: PGlite) {
  return {
    async query<T>(texto: string, parametros: unknown[] = []): Promise<T[]> {
      const { rows } = await db.query<T>(texto, parametros as never[]);
      return rows;
    },
  };
}

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
  resetKeyCache();
  pg = new PGlite();
  await migrate(executor(pg));
});

describe("lote com a migracao 009 pendente", () => {
  it("continua legivel sem a coluna orders_enc", async () => {
    const db = adaptador(pg);
    const id = await criarImportacao(db as never, {
      linhas: [],
      pedidos: [],
      images: 1,
      note: null,
    });

    // Simula o banco de producao antes da migracao rodar.
    await pg.exec("ALTER TABLE shared_imports DROP COLUMN orders_enc");

    const lote = await lerImportacao(db as never, id);
    expect(lote?.id).toBe(id);
    expect(lote?.pedidos).toEqual([]);
    expect(await listarImportacoes(db as never)).toHaveLength(1);
  });
});
