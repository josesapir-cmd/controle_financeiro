import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import { chaveDaCompra } from "@/lib/finance/parcelamento";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  acharOuCriarCategoria,
  listRotulosDeCompra,
  purchaseFingerprint,
  setRotuloDeCompra,
} from "../repository";

/**
 * A categoria de uma compra parcelada.
 *
 * O que se testa aqui e o caminho inteiro: a chave montada a partir de uma
 * parcela tem de encontrar o rotulo gravado a partir de OUTRA parcela — e e
 * disso que depende a parcela de 2027 nao voltar a pedir classificacao.
 */

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

const d = (label: string, value: string) => ({ label, value });

function parcela(n: number) {
  return [
    d("Cartao · cardNumber", "2797"),
    d("Cartao · purchaseDate", "2026-08-10T12:12:44.000Z"),
    d("Cartao · installmentNumber", String(n)),
    d("Cartao · totalInstallments", "10"),
  ];
}

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString("base64");
  resetKeyCache();

  pg = new PGlite();
  db = {
    async query<T>(text: string, params: unknown[] = []) {
      return (await pg.query<T>(text, params)).rows;
    },
  };

  await migrate(executor);
});

afterEach(async () => {
  await pg.close();
});

describe("categoria da compra parcelada", () => {
  it("gravada por uma parcela, encontrada por outra", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;

    const naPrimeira = purchaseFingerprint(chaveDaCompra(parcela(1), "MAGAZINE X")!);
    await setRotuloDeCompra(db, naPrimeira, { categoryId: categoria });

    // A decima parcela cai em outro mes e chega por outra fatura. Se a chave
    // divergisse, ela voltaria a pedir classificacao.
    const naDecima = purchaseFingerprint(chaveDaCompra(parcela(10), "MAGAZINE X")!);
    const [rotulo] = await listRotulosDeCompra(db);

    expect(naDecima).toBe(naPrimeira);
    expect(rotulo.purchaseKey).toBe(naDecima);
    expect(rotulo.categoryId).toBe(categoria);
  });

  it("a chave gravada nao e o texto da compra", async () => {
    // Quem ler a tabela nao pode descobrir onde a compra foi feita.
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    const chave = chaveDaCompra(parcela(1), "MAGAZINE X")!;

    await setRotuloDeCompra(db, purchaseFingerprint(chave), { categoryId: categoria });

    const [rotulo] = await listRotulosDeCompra(db);
    expect(rotulo.purchaseKey).not.toContain("MAGAZINE");
    expect(rotulo.purchaseKey).not.toBe(chave);
  });

  it("limpar a categoria apaga a linha, em vez de deixar uma regra vazia", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    const chave = purchaseFingerprint(chaveDaCompra(parcela(1), "MAGAZINE X")!);

    await setRotuloDeCompra(db, chave, { categoryId: categoria });
    await setRotuloDeCompra(db, chave, { categoryId: null, costCenterId: null });

    expect(await listRotulosDeCompra(db)).toHaveLength(0);
  });

  it("regravar substitui em vez de duplicar", async () => {
    const primeira = (await acharOuCriarCategoria(db, "Compras"))!;
    const segunda = (await acharOuCriarCategoria(db, "Saude"))!;
    const chave = purchaseFingerprint(chaveDaCompra(parcela(1), "MAGAZINE X")!);

    await setRotuloDeCompra(db, chave, { categoryId: primeira });
    await setRotuloDeCompra(db, chave, { categoryId: segunda });

    const rotulos = await listRotulosDeCompra(db);
    expect(rotulos).toHaveLength(1);
    expect(rotulos[0].categoryId).toBe(segunda);
  });

  it("apagar a categoria leva junto o rotulo da compra", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;
    const chave = purchaseFingerprint(chaveDaCompra(parcela(1), "MAGAZINE X")!);
    await setRotuloDeCompra(db, chave, { categoryId: categoria });

    await db.query("DELETE FROM categories WHERE id = $1", [categoria]);

    expect(await listRotulosDeCompra(db)).toHaveLength(0);
  });

  it("compras diferentes nao se misturam", async () => {
    const categoria = (await acharOuCriarCategoria(db, "Compras"))!;

    const uma = purchaseFingerprint(chaveDaCompra(parcela(1), "LOJA A")!);
    const outra = purchaseFingerprint(chaveDaCompra(parcela(1), "LOJA B")!);

    await setRotuloDeCompra(db, uma, { categoryId: categoria });

    expect(uma).not.toBe(outra);
    expect((await listRotulosDeCompra(db)).map((r) => r.purchaseKey)).toEqual([uma]);
  });
});
