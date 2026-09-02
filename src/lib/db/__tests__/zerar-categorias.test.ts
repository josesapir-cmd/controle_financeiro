import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, type Executor } from "../migrate.mjs";
import {
  coletarClassificacao,
  restaurarClassificacao,
  zerarClassificacao,
} from "../zerar-categorias.mjs";

/**
 * A limpeza da classificacao feita a mao.
 *
 * E a parte destrutiva do app: apagar demais aqui e trabalho manual perdido sem
 * volta. Por isso ela roda contra um Postgres de verdade neste teste, e nao so
 * na primeira vez que alguem apertar `--aplicar` no banco que importa.
 */

let pg: PGlite;
let db: { query<T>(texto: string, parametros?: unknown[]): Promise<T[]> };

const executor: Executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

/** Um lancamento com categoria propria, e uma contraparte classificada. */
async function plantar() {
  const { rows } = await pg.query<{ id: string }>(
    "SELECT id FROM categories WHERE lower(name) = 'alimentacao'",
  );
  const categoria = rows[0].id;

  const centro = await pg.query<{ id: string }>(
    "INSERT INTO cost_centers (category_id, name) VALUES ($1, 'Feira') RETURNING id",
    [categoria],
  );

  await pg.exec(`
    INSERT INTO accounts (id, fingerprint, connector_name, type)
    VALUES ('11111111-1111-4111-8111-111111111111', 'fp-conta', 'Nubank', 'CREDIT');

    INSERT INTO transactions (id, account_id, posted_at, local_day, amount)
    VALUES ('tx-1', '11111111-1111-4111-8111-111111111111', now(), '2026-09-01', -50),
           ('tx-2', '11111111-1111-4111-8111-111111111111', now(), '2026-09-01', -20);
  `);

  await pg.query(
    `INSERT INTO transaction_labels (transaction_id, category_id, cost_center_id, note_enc)
     VALUES ('tx-1', $1, $2, 'comentario-cifrado'), ('tx-2', $1, NULL, NULL)`,
    [categoria, centro.rows[0].id],
  );

  await pg.query(
    `INSERT INTO counterparty_labels
       (fingerprint, category, subcategory, cost_center_id, alias_enc, official_name_enc)
     VALUES ('fp-padaria', 'Alimentacao', 'Feira', $1, 'apelido-cifrado', NULL),
            ('fp-uber', 'Transporte', NULL, NULL, NULL, NULL),
            ('fp-so-apelido', NULL, NULL, NULL, 'mae-cifrado', 'oficial-cifrado')`,
    [centro.rows[0].id],
  );
}

beforeEach(async () => {
  pg = new PGlite();
  db = {
    async query<T>(texto: string, parametros: unknown[] = []) {
      return (await pg.query<T>(texto, parametros as never[])).rows;
    },
  };
  await migrate(executor);
  await plantar();
});

afterEach(async () => {
  await pg.close();
});

async function contar(tabela: string): Promise<number> {
  const [linha] = await db.query<{ total: string }>(`SELECT count(*) AS total FROM ${tabela}`);
  return Number(linha.total);
}

describe("zerarClassificacao", () => {
  it("apaga a categoria do lancamento e a da contraparte", async () => {
    await zerarClassificacao(db);

    const sobrou = await coletarClassificacao(db);
    expect(sobrou.transacoes).toEqual([]);
    expect(sobrou.contrapartes).toEqual([]);
  });

  it("preserva o comentario do lancamento", async () => {
    // Comentario nao e categoria: apaga-lo seria levar junto o que ninguem
    // pediu para apagar.
    await zerarClassificacao(db);

    const [linha] = await db.query<{ note_enc: string | null }>(
      "SELECT note_enc FROM transaction_labels WHERE transaction_id = 'tx-1'",
    );
    expect(linha.note_enc).toBe("comentario-cifrado");
  });

  it("some com a linha que nao carrega mais nada", async () => {
    // tx-2 so tinha categoria; sem ela a linha nao guarda coisa alguma.
    await zerarClassificacao(db);

    const linhas = await db.query("SELECT 1 FROM transaction_labels WHERE transaction_id = 'tx-2'");
    expect(linhas).toHaveLength(0);
    expect(await contar("transaction_labels")).toBe(1);
  });

  it("preserva apelido e nome oficial da contraparte", async () => {
    await zerarClassificacao(db);

    const [padaria] = await db.query<{ alias_enc: string | null; category: string | null }>(
      "SELECT alias_enc, category FROM counterparty_labels WHERE fingerprint = 'fp-padaria'",
    );
    expect(padaria.alias_enc).toBe("apelido-cifrado");
    expect(padaria.category).toBeNull();

    // Quem so tinha apelido nem devia ser tocado.
    const [so] = await db.query<{ alias_enc: string }>(
      "SELECT alias_enc FROM counterparty_labels WHERE fingerprint = 'fp-so-apelido'",
    );
    expect(so.alias_enc).toBe("mae-cifrado");
  });

  it("nao apaga os centros de custo", async () => {
    // Sao taxonomia, nao atribuicao: apaga-los levaria junto o orcamento e o
    // periodo de "Bariloche 2026".
    await zerarClassificacao(db);
    expect(await contar("cost_centers")).toBeGreaterThan(0);
  });

  it("nao apaga lancamento nenhum", async () => {
    await zerarClassificacao(db);
    expect(await contar("transactions")).toBe(2);
  });

  it("rodar duas vezes nao muda nada", async () => {
    await zerarClassificacao(db);
    const depoisDaPrimeira = await contar("counterparty_labels");
    await zerarClassificacao(db);
    expect(await contar("counterparty_labels")).toBe(depoisDaPrimeira);
  });
});

describe("restaurarClassificacao", () => {
  it("devolve exatamente o que o backup guardava", async () => {
    const backup = await coletarClassificacao(db);
    await zerarClassificacao(db);
    await restaurarClassificacao(db, backup);

    const voltou = await coletarClassificacao(db);
    expect(voltou.transacoes.map((t) => t.transaction_id)).toEqual(
      backup.transacoes.map((t) => t.transaction_id),
    );
    expect(voltou.transacoes.map((t) => t.category_id)).toEqual(
      backup.transacoes.map((t) => t.category_id),
    );
    expect(voltou.contrapartes.map((c) => c.category)).toEqual(
      backup.contrapartes.map((c) => c.category),
    );
  });

  it("volta a subcategoria e o centro de custo", async () => {
    const backup = await coletarClassificacao(db);
    await zerarClassificacao(db);
    await restaurarClassificacao(db, backup);

    const [padaria] = await db.query<{ subcategory: string; cost_center_id: string | null }>(
      "SELECT subcategory, cost_center_id FROM counterparty_labels WHERE fingerprint = 'fp-padaria'",
    );
    expect(padaria.subcategory).toBe("Feira");
    expect(padaria.cost_center_id).not.toBeNull();
  });

  it("o comentario escrito depois da limpeza vence o do backup", async () => {
    // A limpeza nao apagou comentario; o do arquivo e o mais velho dos dois, e
    // escreve-lo por cima desfaria o que foi escrito depois.
    const backup = await coletarClassificacao(db);
    await zerarClassificacao(db);
    await pg.exec(
      "UPDATE transaction_labels SET note_enc = 'comentario-novo' WHERE transaction_id = 'tx-1'",
    );

    await restaurarClassificacao(db, backup);

    const [linha] = await db.query<{ note_enc: string }>(
      "SELECT note_enc FROM transaction_labels WHERE transaction_id = 'tx-1'",
    );
    expect(linha.note_enc).toBe("comentario-novo");
  });

  it("restaurar duas vezes nao duplica", async () => {
    const backup = await coletarClassificacao(db);
    await zerarClassificacao(db);
    await restaurarClassificacao(db, backup);
    await restaurarClassificacao(db, backup);

    expect((await coletarClassificacao(db)).transacoes).toHaveLength(backup.transacoes.length);
  });

  it("backup vazio nao quebra", async () => {
    await expect(restaurarClassificacao(db, {})).resolves.toBeUndefined();
  });
});
