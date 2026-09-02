import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  criarCentroDeCusto,
  listCategorias,
  listCentrosDeCusto,
  listLabels,
  setLabel,
} from "../repository";

/**
 * A migracao que renomeou "Vestuario e Cuidados Pessoais" para "Compras".
 *
 * Renomear categoria aqui tem duas armadilhas, e uma delas ja derrubou uma
 * migracao neste banco: o nome e unico ignorando caixa MESMO entre arquivadas, e
 * a classificacao da contraparte guarda o NOME em texto, nao o id.
 *
 * A "Compras" que atrapalha nao vem das migracoes — nenhuma a cria. Vem do
 * usuario, que pode te-la digitado na aba de contrapartes; foi assim que uma
 * "Viagens" digitada a mao derrubou a migracao 008. Por isso os testes criam a
 * colisao em vez de supor que ela existe.
 */

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

/** Para no 009: o banco fica no estado anterior a renomeacao. */
async function ateAntesDaRenomeacao() {
  await migrate(executor, () => {}, { ate: "009_produto_do_pedido.sql" });
}

/** A "Compras" que o usuario pode ter criado digitando, arquivada ou nao. */
async function plantarComprasAntiga(arquivada = true) {
  await db.query(
    `INSERT INTO categories (name, kind, archived_at)
     VALUES ('Compras', 'despesa', ${arquivada ? "now()" : "NULL"})`,
  );
}

function aplicarRenomeacao() {
  return migrate(executor);
}

async function porNome(nome: string) {
  const linhas = await db.query<{ id: string; archived_at: string | null }>(
    "SELECT id, archived_at FROM categories WHERE lower(name) = lower($1)",
    [nome],
  );
  return linhas[0] ?? null;
}

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString("base64");
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

describe("Vestuario e Cuidados Pessoais vira Compras", () => {
  it("renomeia mesmo com uma Compras arquivada no caminho", async () => {
    await ateAntesDaRenomeacao();
    await plantarComprasAntiga();

    await aplicarRenomeacao();

    const compras = await listCategorias(db);
    const nomes = compras.map((c) => c.name);
    expect(nomes).toContain("Compras");
    expect(nomes).not.toContain("Vestuario e Cuidados Pessoais");

    // A antiga nao foi destruida: so saiu do caminho, e continua arquivada.
    const antiga = await porNome("Compras (arquivada em 2026)");
    expect(antiga?.archived_at).not.toBeNull();
  });

  it("leva junto o texto gravado na contraparte", async () => {
    await ateAntesDaRenomeacao();
    await setLabel(db, "fp-loja", {
      category: "Vestuario e Cuidados Pessoais",
      subcategory: "Roupa",
    });

    await aplicarRenomeacao();

    // Sem reescrever o texto, esta contraparte cairia em "sem categoria": o app
    // acha a categoria pelo nome, e o nome mudou.
    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBe("Compras");
  });

  it("traz os centros de custo da antiga para a que sobrevive", async () => {
    await ateAntesDaRenomeacao();

    await plantarComprasAntiga();
    const antiga = await porNome("Compras");
    await criarCentroDeCusto(db, antiga!.id, "Presentes de fim de ano");

    await aplicarRenomeacao();

    const sobrevivente = await porNome("Compras");
    const centros = await listCentrosDeCusto(db);
    const nomes = centros
      .filter((c) => c.categoryId === sobrevivente!.id)
      .map((c) => c.name);

    expect(nomes).toContain("Presentes de fim de ano");
  });

  it("nome de centro repetido nas duas nao vira dois", async () => {
    await ateAntesDaRenomeacao();

    await plantarComprasAntiga();
    const antiga = await porNome("Compras");
    const vestuario = await porNome("Vestuario e Cuidados Pessoais");
    await criarCentroDeCusto(db, antiga!.id, "Academia");
    await criarCentroDeCusto(db, vestuario!.id, "Academia");

    await aplicarRenomeacao();

    // O indice de centro e unico por (categoria, nome): mover sem juntar
    // estouraria a migracao inteira.
    const centros = await listCentrosDeCusto(db);
    const academias = centros.filter((c) => c.name.toLowerCase() === "academia");
    expect(academias).toHaveLength(1);
    expect(academias[0].categoryId).toBe(vestuario!.id);
  });

  it("no banco limpo, onde nenhuma Compras existe, e so o nome novo", async () => {
    // E o caso das migracoes rodadas do zero: nenhuma delas cria "Compras".
    await ateAntesDaRenomeacao();
    expect(await porNome("Compras")).toBeNull();

    await aplicarRenomeacao();

    expect(await porNome("Compras")).not.toBeNull();
    expect(await porNome("Compras (arquivada em 2026)")).toBeNull();
  });

  it("uma Compras ATIVA digitada a mao tambem sai do caminho", async () => {
    // A colisao nao depende de estar arquivada: o indice olha o nome, e so.
    await ateAntesDaRenomeacao();
    await plantarComprasAntiga(false);

    await aplicarRenomeacao();

    const nomes = (await listCategorias(db)).map((c) => c.name);
    expect(nomes.filter((n) => n === "Compras")).toHaveLength(1);
    expect(nomes).not.toContain("Vestuario e Cuidados Pessoais");
  });
});

describe("o nome de origem pode ser outro", () => {
  it("renomeia tambem quando a categoria se chama Vestuario e bem estar", async () => {
    // Ha banco em que ela aparece com esse nome. Casar so um deixaria a
    // migracao passar sem fazer nada, em silencio.
    await ateAntesDaRenomeacao();
    await pg.exec(
      "UPDATE categories SET name = 'Vestuario e bem estar' WHERE lower(name) = 'vestuario e cuidados pessoais'",
    );

    await aplicarRenomeacao();

    const nomes = (await listCategorias(db)).map((c) => c.name);
    expect(nomes).toContain("Compras");
    expect(nomes).not.toContain("Vestuario e bem estar");
  });

  it("leva o texto da contraparte junto, com qualquer um dos dois nomes", async () => {
    await ateAntesDaRenomeacao();
    await pg.exec(
      "UPDATE categories SET name = 'Vestuario e bem estar' WHERE lower(name) = 'vestuario e cuidados pessoais'",
    );
    await setLabel(db, "fp-loja", { category: "Vestuario e bem estar" });

    await aplicarRenomeacao();

    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBe("Compras");
  });
});
