import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, type Executor } from "../migrate.mjs";

/**
 * As migracoes rodam contra um Postgres de verdade, compilado para WASM. Isso
 * pega erro de sintaxe, tipo inexistente e referencia quebrada — que um teste
 * de string jamais pegaria — sem depender de um banco remoto.
 */
let pg: PGlite;

function executor(db: PGlite): Executor {
  return {
    async unsafe(query: string) {
      const resultado = await db.exec(query);
      return resultado[resultado.length - 1]?.rows ?? [];
    },
  };
}

beforeEach(async () => {
  pg = new PGlite();
});

afterEach(async () => {
  await pg.close();
});

async function tabelas(): Promise<string[]> {
  const { rows } = await pg.query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  return rows.map((r) => r.table_name);
}

describe("migracoes", () => {
  it("criam o esquema completo", async () => {
    await migrate(executor(pg));

    expect(await tabelas()).toEqual([
      "accounts",
      "app_settings",
      "auth_challenges",
      "categories",
      "connections",
      "cost_centers",
      "counterparty_labels",
      "counterparty_links",
      "credentials",
      "schema_migrations",
      "sessions",
      "shared_imports",
      "sync_runs",
      "transactions",
    ]);
  });

  it("sao idempotentes: rodar duas vezes nao aplica de novo", async () => {
    const primeira = await migrate(executor(pg));
    const segunda = await migrate(executor(pg));

    expect(primeira.length).toBeGreaterThan(0);
    expect(segunda).toEqual([]);
  });

  it("registram o que foi aplicado", async () => {
    await migrate(executor(pg));
    const { rows } = await pg.query<{ name: string }>("SELECT name FROM schema_migrations");
    expect(rows.map((r) => r.name)).toContain("001_init.sql");
  });
});

describe("esquema", () => {
  beforeEach(async () => {
    await migrate(executor(pg));
  });

  it("aceita uma transacao completa e devolve os valores", async () => {
    await pg.exec(`
      INSERT INTO connections (item_id, connector_name)
      VALUES ('11111111-1111-4111-8111-111111111111', 'Inter');

      INSERT INTO accounts (id, fingerprint, item_id, connector_name, type, balance)
      VALUES ('22222222-2222-4222-8222-222222222222', 'fp-conta-1',
              '11111111-1111-4111-8111-111111111111', 'Inter', 'BANK', 3153.01);

      INSERT INTO transactions (id, account_id, posted_at, local_day, amount, category)
      VALUES ('tx-1', '22222222-2222-4222-8222-222222222222',
              '2026-08-26T18:19:21Z', '2026-08-26', -45000.00, 'Investments');
    `);

    const { rows } = await pg.query<{ amount: string; local_day: string }>(
      "SELECT amount, local_day FROM transactions",
    );
    expect(rows[0].amount).toBe("-45000.00");
  });

  // A identidade estavel da conta e o fingerprint: se duas conexoes tentarem
  // registrar a mesma conta, a segunda precisa falhar em vez de duplicar.
  it("impede duas contas com o mesmo fingerprint", async () => {
    await pg.exec(`
      INSERT INTO accounts (fingerprint, connector_name, type)
      VALUES ('fp-duplicado', 'Inter', 'BANK');
    `);

    await expect(
      pg.exec(`
        INSERT INTO accounts (fingerprint, connector_name, type)
        VALUES ('fp-duplicado', 'Inter', 'BANK');
      `),
    ).rejects.toThrow();
  });

  it("apaga as transacoes junto com a conta", async () => {
    await pg.exec(`
      INSERT INTO accounts (id, fingerprint, connector_name, type)
      VALUES ('33333333-3333-4333-8333-333333333333', 'fp-conta-2', 'Nubank', 'CREDIT');

      INSERT INTO transactions (id, account_id, posted_at, local_day, amount)
      VALUES ('tx-2', '33333333-3333-4333-8333-333333333333', now(), '2026-08-26', -10);

      DELETE FROM accounts WHERE id = '33333333-3333-4333-8333-333333333333';
    `);

    const { rows } = await pg.query("SELECT id FROM transactions");
    expect(rows).toHaveLength(0);
  });

  // Desconectar um banco nao pode apagar o historico: e o motivo de existir a
  // persistencia. A conta sobrevive a remocao da conexao.
  it("preserva contas e transacoes quando a conexao e removida", async () => {
    await pg.exec(`
      INSERT INTO connections (item_id, connector_name)
      VALUES ('44444444-4444-4444-8444-444444444444', 'BTG');

      INSERT INTO accounts (id, fingerprint, item_id, connector_name, type)
      VALUES ('55555555-5555-4555-8555-555555555555', 'fp-conta-3',
              '44444444-4444-4444-8444-444444444444', 'BTG', 'BANK');

      INSERT INTO transactions (id, account_id, posted_at, local_day, amount)
      VALUES ('tx-3', '55555555-5555-4555-8555-555555555555', now(), '2026-08-26', -99);

      DELETE FROM connections WHERE item_id = '44444444-4444-4444-8444-444444444444';
    `);

    const contas = await pg.query<{ item_id: string | null }>("SELECT item_id FROM accounts");
    const transacoes = await pg.query("SELECT id FROM transactions");

    expect(contas.rows[0].item_id).toBeNull();
    expect(transacoes.rows).toHaveLength(1);
  });
});
