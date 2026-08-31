import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "@/lib/db/adapter";
import { migrate } from "@/lib/db/migrate.mjs";
import { listAccounts, listTransactions } from "@/lib/db/repository";
import { localDay } from "@/lib/finance/dates";
import { gravarLinhas, paraLancamento } from "../gravar";
import { mesclar, validar, type Linha } from "../linhas";

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
      const resultado = await pg.exec(query);
      return resultado[resultado.length - 1]?.rows ?? [];
    },
  });
});

afterEach(async () => {
  await pg.close();
});

function linhas(
  brutas: { data: string; descricao: string; valor: number; tipo?: string }[],
  envio = 1,
): Linha[] {
  const { linhas: validadas } = validar(
    brutas.map((b) => ({ confianca: "alta", tipo: "despesa", ...b })),
    { envio, arquivos: [`IMG_0${envio}.png`] },
  );
  return mesclar([], validadas);
}

describe("paraLancamento", () => {
  const exemplo = () => linhas([{ data: "2026-05-12", descricao: "Mercado", valor: 129.9 }])[0];

  it("marca a origem para separar do que veio do Open Finance", () => {
    expect(paraLancamento(exemplo(), "conta").origin).toBe("manual");
  });

  it("cai no dia lido, sem escorregar pelo fuso", () => {
    const lancamento = paraLancamento(exemplo(), "conta");

    expect(lancamento.localDay).toBe("2026-05-12");
    expect(localDay(lancamento.postedAt as Date)).toBe("2026-05-12");
  });

  it("usa a descricao como contraparte, para poder ser classificada como as outras", () => {
    const lancamento = paraLancamento(exemplo(), "conta");

    expect(lancamento.counterpartyName).toBe("Mercado");
    expect(lancamento.counterpartyKey).toContain("saldo-compartilhado|");
  });

  it("diz no detalhe que o horario nao foi medido", () => {
    const rotulos = paraLancamento(exemplo(), "conta").details?.map((d) => d.label);

    expect(rotulos).toContain("Horario");
    expect(rotulos).toContain("Origem");
  });
});

describe("gravarLinhas", () => {
  it("cria a conta virtual do saldo compartilhado uma unica vez", async () => {
    await gravarLinhas(db, linhas([{ data: "2026-05-12", descricao: "Mercado", valor: 100 }]));
    await gravarLinhas(db, linhas([{ data: "2026-05-13", descricao: "Farmacia", valor: 40 }]));

    const contas = await listAccounts(db);
    expect(contas).toHaveLength(1);
    expect(contas[0].origin).toBe("manual");
    expect(contas[0].name).toBe("Saldo compartilhado");
  });

  it("regrava o mesmo print sem duplicar lancamentos", async () => {
    const lote = linhas([
      { data: "2026-05-12", descricao: "Mercado", valor: 100 },
      { data: "2026-05-12", descricao: "Farmacia", valor: 40 },
    ]);

    await gravarLinhas(db, lote);
    await gravarLinhas(db, lote);

    expect(await listTransactions(db)).toHaveLength(2);
  });

  it("guarda a despesa com sinal negativo e a entrada positiva", async () => {
    await gravarLinhas(
      db,
      linhas([
        { data: "2026-05-12", descricao: "Mercado", valor: 100 },
        { data: "2026-05-12", descricao: "Estorno", valor: 30, tipo: "entrada" },
      ]),
    );

    const valores = (await listTransactions(db)).map((t) => t.amount).sort((a, b) => a - b);
    expect(valores).toEqual([-100, 30]);
  });

  it("nao faz nada quando nao ha linhas — nem cria a conta virtual", async () => {
    expect(await gravarLinhas(db, [])).toBe(0);
    expect(await listAccounts(db)).toHaveLength(0);
  });
});
