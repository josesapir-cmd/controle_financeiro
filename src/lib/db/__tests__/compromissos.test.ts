import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  apagarChamada,
  criarCompromisso,
  encerrarCompromisso,
  listChamadas,
  listCompromissos,
  liquidarChamada,
  registrarChamada,
  salvarChamada,
  salvarCompromisso,
} from "../repository";

/**
 * Compromissos de capital e as chamadas que os consomem.
 *
 * O que se testa e o que pode dar errado em silencio: o mesmo fundo entrando
 * duas vezes, uma chamada gravada em compromisso que nao existe, e um valor
 * invalido que passaria e depois estragaria a soma da tela.
 */

let pg: PGlite;
let db: Db;

const executor = {
  async unsafe(query: string) {
    const resultado = await pg.exec(query);
    return resultado[resultado.length - 1]?.rows ?? [];
  },
};

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 19).toString("base64");
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

describe("compromissos de capital", () => {
  it("guarda o fundo com o total prometido", async () => {
    const id = await criarCompromisso(db, {
      name: "Fundo Alfa",
      committed: 500000,
      signedOn: "2026-03-15",
      note: "primeira safra",
    });

    expect(id).toBeTruthy();

    const [fundo] = await listCompromissos(db);
    expect(fundo.name).toBe("Fundo Alfa");
    expect(fundo.committed).toBe(500000);
    expect(fundo.signedOn).toBe("2026-03-15");
    expect(fundo.note).toBe("primeira safra");
    expect(fundo.closed).toBe(false);
  });

  it("nao duplica o fundo quando o nome ja existe, ignorando caixa", async () => {
    // Duas linhas para o mesmo fundo escondem justamente o que a tela mostra:
    // o compromisso apareceria pela metade em cada uma.
    const primeiro = await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 });
    const segundo = await criarCompromisso(db, { name: "FUNDO ALFA", committed: 900000 });

    expect(segundo).toBe(primeiro);
    expect(await listCompromissos(db)).toHaveLength(1);
  });

  it("recusa compromisso sem nome ou sem valor positivo", async () => {
    expect(await criarCompromisso(db, { name: "   ", committed: 100 })).toBeNull();
    expect(await criarCompromisso(db, { name: "Fundo", committed: 0 })).toBeNull();
    expect(await criarCompromisso(db, { name: "Fundo", committed: -5 })).toBeNull();
    expect(await listCompromissos(db)).toHaveLength(0);
  });

  it("registra chamadas e as devolve da mais recente para a mais antiga", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;

    await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 50000 });
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-08-02", amount: 75000 });
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-06-01", amount: 25000 });

    // Ordenadas pela data da chamada, e nao pela de digitacao: chamada antiga
    // lembrada depois tem de cair no lugar certo.
    expect((await listChamadas(db)).map((c) => c.calledOn)).toEqual([
      "2026-08-02",
      "2026-06-01",
      "2026-04-10",
    ]);
  });

  it("recusa chamada com id, data ou valor invalidos", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;

    expect(
      await registrarChamada(db, { commitmentId: "nao-e-uuid", calledOn: "2026-04-10", amount: 1 }),
    ).toBeNull();
    expect(await registrarChamada(db, { commitmentId: id, calledOn: "10/04/2026", amount: 1 })).toBeNull();
    expect(await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 0 })).toBeNull();

    expect(await listChamadas(db)).toHaveLength(0);
  });

  it("apagar o compromisso leva junto as chamadas dele", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 50000 });

    await db.query("DELETE FROM fund_commitments WHERE id = $1", [id]);

    expect(await listChamadas(db)).toHaveLength(0);
  });

  it("encerrar tira o fundo da lista sem apagar chamada nenhuma", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 50000 });

    await encerrarCompromisso(db, id);

    expect(await listCompromissos(db)).toHaveLength(0);
    expect(await listCompromissos(db, true)).toHaveLength(1);
    expect(await listChamadas(db)).toHaveLength(1);

    await encerrarCompromisso(db, id, false);
    expect(await listCompromissos(db)).toHaveLength(1);
  });

  it("editar troca o valor do compromisso sem tocar nas chamadas", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 50000 });

    await salvarCompromisso(db, id, { name: "Fundo Alfa II", committed: 900000 });

    const [fundo] = await listCompromissos(db);
    expect(fundo.name).toBe("Fundo Alfa II");
    expect(fundo.committed).toBe(900000);
    expect(await listChamadas(db)).toHaveLength(1);
  });

  it("remove uma chamada digitada errado", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    const chamada = (await registrarChamada(db, {
      commitmentId: id,
      calledOn: "2026-04-10",
      amount: 500000,
    }))!;

    await apagarChamada(db, chamada);
    expect(await listChamadas(db)).toHaveLength(0);
  });

  it("ignora id que nem uuid e, em vez de estourar", async () => {
    await expect(salvarCompromisso(db, "abc", { name: "x", committed: 1 })).resolves.toBeUndefined();
    await expect(encerrarCompromisso(db, "abc")).resolves.toBeUndefined();
    await expect(apagarChamada(db, "abc")).resolves.toBeUndefined();
  });
});

describe("liquidacao das chamadas", () => {
  it("chamada nova nasce pendente: registrar nao e pagar", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    await registrarChamada(db, { commitmentId: id, calledOn: "2026-04-10", amount: 50000 });

    const [chamada] = await listChamadas(db);
    expect(chamada.liquidada).toBe(false);
  });

  it("liquidar marca e desmarca", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    const chamada = (await registrarChamada(db, {
      commitmentId: id,
      calledOn: "2026-04-10",
      amount: 50000,
    }))!;

    await liquidarChamada(db, chamada);
    expect((await listChamadas(db))[0].liquidada).toBe(true);

    await liquidarChamada(db, chamada, false);
    expect((await listChamadas(db))[0].liquidada).toBe(false);
  });

  it("editar troca data, valor e nota da chamada", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    const chamada = (await registrarChamada(db, {
      commitmentId: id,
      calledOn: "2026-04-10",
      amount: 50000,
    }))!;

    await salvarChamada(db, chamada, {
      calledOn: "2026-04-22",
      amount: 61500,
      note: "call 1 revisada",
    });

    const [depois] = await listChamadas(db);
    expect(depois.calledOn).toBe("2026-04-22");
    expect(depois.amount).toBe(61500);
    expect(depois.note).toBe("call 1 revisada");
  });

  it("editar recusa valor ou data invalidos em vez de gravar lixo", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    const chamada = (await registrarChamada(db, {
      commitmentId: id,
      calledOn: "2026-04-10",
      amount: 50000,
    }))!;

    await salvarChamada(db, chamada, { calledOn: "22/04/2026", amount: 61500 });
    await salvarChamada(db, chamada, { calledOn: "2026-04-22", amount: 0 });

    const [depois] = await listChamadas(db);
    expect(depois.calledOn).toBe("2026-04-10");
    expect(depois.amount).toBe(50000);
  });

  it("editar nao mexe na liquidacao ja registrada", async () => {
    const id = (await criarCompromisso(db, { name: "Fundo Alfa", committed: 500000 }))!;
    const chamada = (await registrarChamada(db, {
      commitmentId: id,
      calledOn: "2026-04-10",
      amount: 50000,
    }))!;

    await liquidarChamada(db, chamada);
    await salvarChamada(db, chamada, { calledOn: "2026-04-22", amount: 61500 });

    expect((await listChamadas(db))[0].liquidada).toBe(true);
  });
});
