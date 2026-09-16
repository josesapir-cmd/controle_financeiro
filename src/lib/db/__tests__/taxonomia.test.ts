import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  acharOuCriarCategoria,
  criarCentroDeCusto,
  listCategorias,
  listCentrosDeCusto,
  listLabels,
  salvarCategoria,
  salvarCentroDeCusto,
  setLabel,
} from "../repository";

/**
 * A migracao que enxugou a taxonomia para dez categorias.
 *
 * O que se testa aqui e o caminho de dados, nao o esquema: mudar a taxonomia sem
 * perder classificacao feita a mao e a parte que pode dar errado em silencio.
 */

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

/** Para no 007: o banco fica no estado anterior ao enxugamento. */
async function ateAntesDoEnxugamento() {
  await migrate(executor, () => {}, { ate: "007_cor_e_rotulo_por_lancamento.sql" });
}

function aplicarEnxugamento() {
  return migrate(executor);
}

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString("base64");
  resetKeyCache();

  pg = new PGlite();
  db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };
});

afterEach(async () => {
  await pg.close();
});

describe("enxugamento da taxonomia", () => {
  it("renomeia levando junto o texto gravado na contraparte", async () => {
    await ateAntesDoEnxugamento();
    await setLabel(db, "fp-mercado", { category: "Mantimentos", subcategory: "Feira" });

    await aplicarEnxugamento();

    // Sem reescrever o texto, esta contraparte cairia em "sem categoria" — que e
    // exatamente o trabalho manual sendo perdido em silencio.
    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBe("Alimentacao");
    expect(rotulo.subcategory).toBe("Feira");
  });

  // O caso que quebrou no banco real: o usuario ja tinha criado "Viagens"
  // digitando em Contrapartes, e renomear "Viagem" para ele violava a unicidade.
  it("funde quando o nome de destino ja existe, em vez de estourar", async () => {
    await ateAntesDoEnxugamento();
    await db.query(
      `INSERT INTO categories (name, kind, position, hue) VALUES ('Viagens', 'despesa', 100, 30)`,
    );
    await setLabel(db, "fp-hotel", { category: "Viagem", subcategory: "Bariloche" });

    await expect(aplicarEnxugamento()).resolves.toBeDefined();

    const viagens = (await listCategorias(db)).filter((c) => /viagens/i.test(c.name));
    expect(viagens).toHaveLength(1);
    expect((await listLabels(db))[0].category).toBe("Viagens");
  });

  it("leva os centros de custo da categoria fundida", async () => {
    await ateAntesDoEnxugamento();
    const [{ id }] = await db.query<{ id: string }>(
      `SELECT id FROM categories WHERE lower(name) = 'familia'`,
    );
    await db.query(`INSERT INTO cost_centers (category_id, name) VALUES ($1, 'Pai')`, [id]);

    await aplicarEnxugamento();

    const presentes = (await listCategorias(db)).find((c) => /^Presentes/.test(c.name))!;
    const centros = (await listCentrosDeCusto(db)).filter((c) => c.categoryId === presentes.id);
    expect(centros.map((c) => c.name)).toContain("Pai");
  });

  it("nao duplica centro de custo de mesmo nome ao fundir", async () => {
    await ateAntesDoEnxugamento();
    const linhas = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM categories WHERE lower(name) IN ('familia', 'doacao')`,
    );
    for (const categoria of linhas) {
      await db.query(`INSERT INTO cost_centers (category_id, name) VALUES ($1, 'Mae')`, [
        categoria.id,
      ]);
    }

    await aplicarEnxugamento();

    const presentes = (await listCategorias(db)).find((c) => /^Presentes/.test(c.name))!;
    const maes = (await listCentrosDeCusto(db)).filter(
      (c) => c.categoryId === presentes.id && c.name === "Mae",
    );
    expect(maes).toHaveLength(1);
  });

  // Adivinhar enterraria dinheiro na categoria errada em silencio; limpar poe o
  // problema na fila de classificar, onde da para ver.
  it("limpa o rotulo do que nao tem sucessora, em vez de chutar", async () => {
    await ateAntesDoEnxugamento();
    await setLabel(db, "fp-pet", { category: "Pet", subcategory: "Racao", alias: "Pet shop" });

    await aplicarEnxugamento();

    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBeNull();
    expect(rotulo.subcategory).toBeNull();
    // O apelido nao e categoria: tirar a classificacao nao pode levar junto o
    // nome que o usuario deu a contraparte.
    expect(rotulo.alias).toBe("Pet shop");
  });

  it("deixa exatamente as dez de despesa ativas", async () => {
    await ateAntesDoEnxugamento();
    await aplicarEnxugamento();

    const despesas = (await listCategorias(db)).filter((c) => c.kind === "despesa");
    expect(despesas).toHaveLength(10);
  });

  it("e idempotente: rodar de novo nao muda nada", async () => {
    await aplicarEnxugamento();
    const antes = (await listCategorias(db)).map((c) => c.name).sort();

    await expect(migrate(executor)).resolves.toEqual([]);
    expect((await listCategorias(db)).map((c) => c.name).sort()).toEqual(antes);
  });
});

describe("renomear sem perder o resto", () => {
  beforeEach(aplicarEnxugamento);

  it("troca o nome do centro sem apagar orcamento, datas e nota", async () => {
    // O bug que isto impede: `salvarCentroDeCusto` gravava nota, datas e
    // orcamento incondicionalmente. Um formulario que so renomeia mandaria
    // apenas o nome, e os outros campos iriam a nulo — calados, porque gravar
    // nulo por cima e uma escrita bem-sucedida.
    const categoria = await acharOuCriarCategoria(db, "Viagens", "despesa");
    const id = await criarCentroDeCusto(db, categoria!, "Bariloche");

    await salvarCentroDeCusto(db, id!, {
      name: "Bariloche",
      note: "ski com a familia",
      startsOn: "2026-07-10",
      endsOn: "2026-07-24",
      budget: 40000,
    });

    await salvarCentroDeCusto(db, id!, { name: "Bariloche 2026" });

    const [centro] = (await listCentrosDeCusto(db)).filter((c) => c.id === id);
    expect(centro.name).toBe("Bariloche 2026");
    expect(centro.note).toBe("ski com a familia");
    expect(centro.startsOn).toBe("2026-07-10");
    expect(centro.endsOn).toBe("2026-07-24");
    expect(centro.budget).toBe(40000);
  });

  it("passar nulo continua limpando, que e diferente de nao passar", async () => {
    const categoria = await acharOuCriarCategoria(db, "Viagens", "despesa");
    const id = await criarCentroDeCusto(db, categoria!, "Bariloche");

    await salvarCentroDeCusto(db, id!, { name: "Bariloche", budget: 40000, note: "ski" });
    await salvarCentroDeCusto(db, id!, { budget: null });

    const [centro] = (await listCentrosDeCusto(db)).filter((c) => c.id === id);
    expect(centro.budget).toBeNull();
    expect(centro.note).toBe("ski");
  });

  it("nome vazio nao apaga o nome que existe", async () => {
    const categoria = await acharOuCriarCategoria(db, "Viagens", "despesa");
    const id = await criarCentroDeCusto(db, categoria!, "Bariloche");

    await salvarCentroDeCusto(db, id!, { name: "   " });

    const [centro] = (await listCentrosDeCusto(db)).filter((c) => c.id === id);
    expect(centro.name).toBe("Bariloche");
  });

  it("renomear a categoria nao mexe no tipo dela", async () => {
    // A categoria Investimentos e `kind: investimento` justamente para nao
    // aparecer nos relatorios de despesa. Renomear nao pode rebaixa-la.
    const id = await acharOuCriarCategoria(db, "Investimentos", "investimento");

    await salvarCategoria(db, id!, { name: "Aportes" });

    const categoria = (await listCategorias(db)).find((c) => c.id === id)!;
    expect(categoria.name).toBe("Aportes");
    expect(categoria.kind).toBe("investimento");
  });
});
