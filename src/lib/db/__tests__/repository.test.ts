import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import type { Db } from "../adapter";
import { migrate } from "../migrate.mjs";
import {
  accountFingerprint,
  acharOuCriarCategoria,
  acharOuCriarCentroDeCusto,
  anexarImportacao,
  arquivarCentroDeCusto,
  listCategorias,
  listCentrosDeCusto,
  salvarCategoria,
  salvarCentroDeCusto,
  clearCounterpartyLink,
  listCounterpartyLinks,
  setCounterpartyLink,
  criarImportacao,
  encerrarImportacao,
  ensureSharedBalanceAccount,
  lerImportacao,
  listAccounts,
  listarImportacoes,
  listLabels,
  listTransactions,
  markSync,
  setLabel,
  syncStatus,
  upsertAccount,
  upsertConnection,
  upsertTransactions,
} from "../repository";

const ITEM = "11111111-1111-4111-8111-111111111111";

let pg: PGlite;
let db: Db;

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 3).toString("base64");
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

  await upsertConnection(db, { itemId: ITEM, connectorName: "Inter", connectorId: 823 });
});

afterEach(async () => {
  await pg.close();
});

async function contaExemplo(numero = "01212573-3") {
  return upsertAccount(db, {
    itemId: ITEM,
    pluggyAccountId: "22222222-2222-4222-8222-222222222222",
    connectorName: "Inter",
    type: "BANK",
    name: "BANCO INTER",
    number: numero,
    balance: 3153.01,
  });
}

describe("contas", () => {
  it("grava e devolve com os campos decifrados", async () => {
    await contaExemplo();
    const [conta] = await listAccounts(db);

    expect(conta.name).toBe("BANCO INTER");
    expect(conta.number).toBe("01212573-3");
    expect(conta.balance).toBeCloseTo(3153.01, 2);
  });

  // O nome e o numero da conta nao podem estar legiveis no banco: e o ponto
  // inteiro da criptografia na aplicacao.
  it("nao guarda nome nem numero em claro", async () => {
    await contaExemplo();
    const { rows } = await pg.query<{ name_enc: string; number_enc: string }>(
      "SELECT name_enc, number_enc FROM accounts",
    );

    expect(rows[0].name_enc).not.toContain("INTER");
    expect(rows[0].number_enc).not.toContain("01212573");
    expect(rows[0].name_enc.startsWith("v1.")).toBe(true);
  });

  it("atualiza a mesma conta em vez de duplicar", async () => {
    const primeiro = await contaExemplo();
    const segundo = await contaExemplo();

    expect(segundo).toBe(primeiro);
    expect(await listAccounts(db)).toHaveLength(1);
  });

  // A promessa central da persistencia: reconectar um banco gera itemId novo,
  // e a conta precisa continuar sendo a mesma.
  it("mantem a identidade quando a conexao e recriada", async () => {
    const antes = await contaExemplo();

    const novoItem = "99999999-9999-4999-8999-999999999999";
    await upsertConnection(db, { itemId: novoItem, connectorName: "Inter" });
    const depois = await upsertAccount(db, {
      itemId: novoItem,
      pluggyAccountId: "33333333-3333-4333-8333-333333333333",
      connectorName: "Inter",
      type: "BANK",
      name: "BANCO INTER",
      number: "01212573-3",
      balance: 3200,
    });

    expect(depois).toBe(antes);
    expect(await listAccounts(db)).toHaveLength(1);
  });

  it("distingue contas diferentes da mesma instituicao", async () => {
    await contaExemplo("01212573-3");
    await contaExemplo("00099999-1");
    expect(await listAccounts(db)).toHaveLength(2);
  });

  it("produz fingerprints diferentes para contas distintas", () => {
    expect(accountFingerprint("BANCO INTER", "123", "CHECKING_ACCOUNT")).not.toBe(
      accountFingerprint("Nu Pagamentos", "123", "CHECKING_ACCOUNT"),
    );
  });

  // Caso real: no BTG, duas contas correntes distintas tem o mesmo numero.
  it("distingue contas de mesmo numero pelo nome", async () => {
    await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "44444444-4444-4444-8444-444444444444",
      connectorName: "BTG", type: "BANK", subtype: "CHECKING_ACCOUNT",
      name: "BTG Pactual WM", number: "00028026-9", balance: 0.44,
    });
    await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "55555555-5555-4555-8555-555555555555",
      connectorName: "BTG", type: "BANK", subtype: "CHECKING_ACCOUNT",
      name: "BTG Banking", number: "00028026-9", balance: 1960,
    });

    expect(await listAccounts(db)).toHaveLength(2);
  });

  // A identidade nao pode depender do nome da instituicao: ele vem do item, e
  // ha conexoes que respondem 404 nele enquanto entregam contas.
  it("mantem a identidade quando o nome da instituicao muda", async () => {
    const antes = await contaExemplo();
    const depois = await upsertAccount(db, {
      itemId: ITEM, pluggyAccountId: "22222222-2222-4222-8222-222222222222",
      connectorName: "(desconhecido)", type: "BANK",
      name: "BANCO INTER", number: "01212573-3", balance: 3153.01,
    });

    expect(depois).toBe(antes);
  });
});

describe("transacoes", () => {
  it("grava e devolve decifrado", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      {
        id: "tx-1",
        accountId,
        postedAt: "2026-08-26T18:19:21.000Z",
        localDay: "2026-08-26",
        amount: -45000,
        category: "Investments",
        description: "Aplicacao - Cdb Pos Di Liq",
        counterpartyKey: "12345678901",
        counterpartyName: "Maria Locadora",
        counterpartyDocument: "12345678901",
        details: [{ label: "Meio", value: "Pix" }],
      },
    ]);

    const [t] = await listTransactions(db);
    expect(t.description).toBe("Aplicacao - Cdb Pos Di Liq");
    expect(t.counterpartyName).toBe("Maria Locadora");
    expect(t.details).toEqual([{ label: "Meio", value: "Pix" }]);
    expect(t.amount).toBe(-45000);
    expect(t.localDay).toBe("2026-08-26");
  });

  it("nao guarda descricao nem contraparte em claro", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      {
        id: "tx-2",
        accountId,
        postedAt: "2026-08-26T18:19:21.000Z",
        localDay: "2026-08-26",
        amount: -100,
        description: "Supermercado Pao de Acucar",
        counterpartyName: "Padaria Central",
      },
    ]);

    const { rows } = await pg.query<{ description_enc: string; counterparty_name_enc: string }>(
      "SELECT description_enc, counterparty_name_enc FROM transactions",
    );
    expect(rows[0].description_enc).not.toContain("Supermercado");
    expect(rows[0].counterparty_name_enc).not.toContain("Padaria");
  });

  // Re-sincronizar o mesmo periodo precisa atualizar, nao duplicar.
  it("e idempotente pelo id da Pluggy", async () => {
    const accountId = await contaExemplo();
    const base = {
      id: "tx-3",
      accountId,
      postedAt: "2026-08-26T12:00:00.000Z",
      localDay: "2026-08-26",
      amount: -10,
    };

    await upsertTransactions(db, [base]);
    await upsertTransactions(db, [{ ...base, amount: -20 }]);

    const todas = await listTransactions(db);
    expect(todas).toHaveLength(1);
    expect(todas[0].amount).toBe(-20);
  });

  it("preserva first_seen_at ao reprocessar", async () => {
    const accountId = await contaExemplo();
    const base = {
      id: "tx-4",
      accountId,
      postedAt: "2026-08-26T12:00:00.000Z",
      localDay: "2026-08-26",
      amount: -10,
    };

    await upsertTransactions(db, [base]);
    const antes = (await pg.query<{ first_seen_at: string }>("SELECT first_seen_at FROM transactions"))
      .rows[0].first_seen_at;

    await upsertTransactions(db, [{ ...base, amount: -30 }]);
    const depois = (await pg.query<{ first_seen_at: string }>("SELECT first_seen_at FROM transactions"))
      .rows[0].first_seen_at;

    expect(String(depois)).toBe(String(antes));
  });

  it("filtra por periodo", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "a", accountId, postedAt: "2026-07-20T12:00:00Z", localDay: "2026-07-20", amount: -1 },
      { id: "b", accountId, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -2 },
      { id: "c", accountId, postedAt: "2026-09-02T12:00:00Z", localDay: "2026-09-02", amount: -3 },
    ]);

    const agosto = await listTransactions(db, { from: "2026-08-01", to: "2026-08-31" });
    expect(agosto.map((t) => t.id)).toEqual(["b"]);
  });

  it("filtra por conta", async () => {
    const conta1 = await contaExemplo("111-1");
    const conta2 = await contaExemplo("222-2");
    await upsertTransactions(db, [
      { id: "a", accountId: conta1, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -1 },
      { id: "b", accountId: conta2, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -2 },
    ]);

    const so1 = await listTransactions(db, { accountIds: [conta1] });
    expect(so1.map((t) => t.id)).toEqual(["a"]);
  });

  // Chave de agrupamento precisa ser deterministica, senao a aba de
  // contrapartes nao consegue somar por pessoa.
  it("gera o mesmo fingerprint de contraparte para o mesmo documento", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "a", accountId, postedAt: "2026-08-01T12:00:00Z", localDay: "2026-08-01", amount: -1, counterpartyKey: "12345678901" },
      { id: "b", accountId, postedAt: "2026-08-02T12:00:00Z", localDay: "2026-08-02", amount: -2, counterpartyKey: "12345678901" },
    ]);

    const [x, y] = await listTransactions(db);
    expect(x.counterpartyFingerprint).toBe(y.counterpartyFingerprint);
    expect(x.counterpartyFingerprint).not.toContain("12345678901");
  });
});

describe("rotulos de contraparte", () => {
  it("grava e devolve com o apelido decifrado", async () => {
    await setLabel(db, "fp-contraparte", {
      category: "Viagem",
      subcategory: "Viagem FDS Familia",
      alias: "Hotel Fazenda Cascatinha",
    });

    const [rotulo] = await listLabels(db);
    expect(rotulo.category).toBe("Viagem");
    expect(rotulo.alias).toBe("Hotel Fazenda Cascatinha");
  });

  it("nao guarda o apelido em claro", async () => {
    await setLabel(db, "fp-contraparte", { alias: "Hotel Fazenda Cascatinha" });
    const { rows } = await pg.query<{ alias_enc: string }>("SELECT alias_enc FROM counterparty_labels");
    expect(rows[0].alias_enc).not.toContain("Cascatinha");
  });

  it("apaga o registro quando todos os campos ficam vazios", async () => {
    await setLabel(db, "fp-contraparte", { category: "Viagem" });
    await setLabel(db, "fp-contraparte", { category: "", subcategory: "", alias: "" });
    expect(await listLabels(db)).toHaveLength(0);
  });
});

describe("estado de sincronizacao", () => {
  it("registra sucesso e erro por conexao", async () => {
    await markSync(db, ITEM, null);
    const [ok] = await syncStatus(db);
    expect(ok.lastSyncedAt).toBeInstanceOf(Date);
    expect(ok.lastSyncError).toBeNull();

    await markSync(db, ITEM, "Pluggy respondeu 504");
    const [erro] = await syncStatus(db);
    expect(erro.lastSyncError).toBe("Pluggy respondeu 504");
  });
});

describe("remocao de conexao", () => {
  /**
   * O comportamento que o usuario vai exercitar ao trocar de banco: tirar a
   * conexao precisa manter o historico e parar de contar o saldo.
   */
  it("arquiva as contas mas preserva as transacoes", async () => {
    const accountId = await contaExemplo();
    await upsertTransactions(db, [
      { id: "tx-hist", accountId, postedAt: "2026-08-10T12:00:00Z", localDay: "2026-08-10", amount: -123 },
    ]);

    await db.query("DELETE FROM connections WHERE item_id = $1", [ITEM]);

    // Fora do patrimonio: o saldo congelado mentiria.
    expect(await listAccounts(db)).toHaveLength(0);
    // Historico intacto: transacoes sao fatos passados.
    expect(await listTransactions(db)).toHaveLength(1);
  });

  it("reconectar a mesma conta a desarquiva", async () => {
    await contaExemplo();
    await db.query("DELETE FROM connections WHERE item_id = $1", [ITEM]);
    expect(await listAccounts(db)).toHaveLength(0);

    const novoItem = "77777777-7777-4777-8777-777777777777";
    await upsertConnection(db, { itemId: novoItem, connectorName: "XP" });
    await upsertAccount(db, {
      itemId: novoItem,
      pluggyAccountId: "88888888-8888-4888-8888-888888888888",
      connectorName: "XP",
      type: "BANK",
      name: "BANCO INTER",
      number: "01212573-3",
      balance: 4000,
    });

    const [conta] = await listAccounts(db);
    expect(conta.balance).toBe(4000);
  });
});

describe("identidade nao depende do nome de exibicao", () => {
  /**
   * O marketingName aparece e some entre sincronizacoes. Quando ele entrava na
   * identidade, reconectar um banco criava uma conta nova e partia o historico
   * — foi o que aconteceu com a conta corrente do Nubank.
   */
  it("mantem a mesma conta quando so o nome de exibicao muda", async () => {
    const primeiro = await upsertAccount(db, {
      itemId: ITEM,
      pluggyAccountId: "66666666-6666-4666-8666-666666666666",
      connectorName: "Nubank",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      identityName: "Nu Pagamentos S.A.",
      name: "Nu Pagamentos S.A.",
      number: "09693994-9",
      balance: 100,
    });

    const segundo = await upsertAccount(db, {
      itemId: ITEM,
      pluggyAccountId: "66666666-6666-4666-8666-666666666666",
      connectorName: "Nubank",
      type: "BANK",
      subtype: "CHECKING_ACCOUNT",
      identityName: "Nu Pagamentos S.A.",
      // Nome de exibicao diferente, vindo do marketingName.
      name: "Conta do Nu",
      number: "09693994-9",
      balance: 150,
    });

    expect(segundo).toBe(primeiro);
    expect(await listAccounts(db)).toHaveLength(1);
  });
});

describe("conta virtual do saldo compartilhado", () => {
  it("e idempotente: chamar duas vezes devolve a mesma conta", async () => {
    const primeira = await ensureSharedBalanceAccount(db);
    const segunda = await ensureSharedBalanceAccount(db);

    expect(primeira).toBe(segunda);
  });

  it("nasce sem conexao e marcada como manual, para ficar fora do patrimonio", async () => {
    await ensureSharedBalanceAccount(db);
    const [conta] = await listAccounts(db);

    expect(conta.itemId).toBeNull();
    expect(conta.origin).toBe("manual");
    expect(conta.balance).toBe(0);
  });
});

describe("lotes lidos de print", () => {
  const linhas = [
    {
      id: "print:a",
      dia: "2026-05-12",
      descricao: "Mercado",
      valor: -100,
      confianca: "alta",
      ocorrencia: 1,
      envio: 1,
      arquivos: ["IMG_01.png"],
      duplicada: false,
    },
  ];

  it("guarda e recupera as linhas, com o conteudo cifrado no banco", async () => {
    const id = await criarImportacao(db, { linhas, images: 2, note: "borrado" });
    const lote = await lerImportacao(db, id);

    expect(lote?.status).toBe("pendente");
    expect(lote?.images).toBe(2);
    expect(lote?.note).toBe("borrado");
    expect(lote?.linhas).toEqual(linhas);

    const cru = await db.query<{ lines_enc: string }>("SELECT lines_enc FROM shared_imports");
    expect(cru[0].lines_enc).not.toContain("Mercado");
  });

  it("devolve null para lote inexistente", async () => {
    expect(await lerImportacao(db, "00000000-0000-4000-8000-000000000000")).toBeNull();
  });

  // O id vem da URL: texto qualquer tem que virar "nao encontrado", nao erro.
  it("devolve null para id que nem uuid e", async () => {
    expect(await lerImportacao(db, "../etc/passwd")).toBeNull();
  });

  // Confirmar duas vezes nao pode lancar o mesmo lote de novo.
  it("so encerra um lote pendente", async () => {
    const id = await criarImportacao(db, { linhas, images: 1 });

    await encerrarImportacao(db, id, "confirmado");
    await encerrarImportacao(db, id, "descartado");

    expect((await lerImportacao(db, id))?.status).toBe("confirmado");
  });

  it("acrescenta um envio ao lote pendente, somando imagens e envios", async () => {
    const id = await criarImportacao(db, { linhas, images: 2, note: "primeiro" });
    const mais = [...linhas, { ...linhas[0], id: "print:b", envio: 2, arquivos: ["IMG_02.png"] }];

    expect(await anexarImportacao(db, id, { linhas: mais, imagens: 3, note: "segundo" })).toBe(true);

    const lote = await lerImportacao(db, id);
    expect(lote?.images).toBe(5);
    expect(lote?.envios).toBe(2);
    expect(lote?.linhas).toHaveLength(2);
    // As observacoes se somam: cada uma fala de imagens diferentes.
    expect(lote?.note).toBe("primeiro\nsegundo");
  });

  // Um envio atrasado da fila nao pode cair num lote ja confirmado: somaria
  // linhas nunca conferidas a algo que o usuario deu por fechado.
  it("recusa acrescentar a lote ja encerrado", async () => {
    const id = await criarImportacao(db, { linhas, images: 1 });
    await encerrarImportacao(db, id, "confirmado");

    expect(await anexarImportacao(db, id, { linhas, imagens: 1 })).toBe(false);
    expect((await lerImportacao(db, id))?.images).toBe(1);
  });

  it("lista do mais recente para o mais antigo", async () => {
    const antigo = await criarImportacao(db, { linhas, images: 1 });
    await db.query("UPDATE shared_imports SET created_at = now() - interval '1 hour' WHERE id = $1", [
      antigo,
    ]);
    const novo = await criarImportacao(db, { linhas, images: 1 });

    expect((await listarImportacoes(db)).map((l) => l.id)).toEqual([novo, antigo]);
  });
});

describe("nome oficial da contraparte", () => {
  it("guarda nome oficial e apelido como campos distintos, ambos cifrados", async () => {
    await setLabel(db, "fp1", { alias: "Cascatinha", officialName: "HOTEL FAZENDA CASCATINHA LTDA" });

    const [rotulo] = await listLabels(db);
    expect(rotulo.alias).toBe("Cascatinha");
    expect(rotulo.officialName).toBe("HOTEL FAZENDA CASCATINHA LTDA");

    const cru = await db.query<{ alias_enc: string; official_name_enc: string }>(
      "SELECT alias_enc, official_name_enc FROM counterparty_labels",
    );
    expect(cru[0].alias_enc).not.toContain("Cascatinha");
    expect(cru[0].official_name_enc).not.toContain("CASCATINHA");
  });

  it("apaga o registro so quando nenhum dos campos sobra", async () => {
    await setLabel(db, "fp1", { officialName: "SO O NOME" });
    expect(await listLabels(db)).toHaveLength(1);

    await setLabel(db, "fp1", { officialName: "" });
    expect(await listLabels(db)).toHaveLength(0);
  });
});

describe("decisoes de identidade entre contrapartes", () => {
  it("guarda uniao e separacao, distinguindo destino nulo de ausencia", async () => {
    await setCounterpartyLink(db, "curta", "longa");
    await setCounterpartyLink(db, "outra", null);

    const decisoes = await listCounterpartyLinks(db);
    expect(decisoes).toEqual({ curta: "longa", outra: null });
    // "outra" existe com valor nulo: e a decisao "sao diferentes", nao a
    // ausencia de decisao. A distincao e o que impede a sugestao de voltar.
    expect("outra" in decisoes).toBe(true);
  });

  it("a decisao mais recente substitui a anterior", async () => {
    await setCounterpartyLink(db, "curta", "longa");
    await setCounterpartyLink(db, "curta", null);

    expect(await listCounterpartyLinks(db)).toEqual({ curta: null });
  });

  it("ignora contraparte apontando para si mesma", async () => {
    await setCounterpartyLink(db, "mesma", "mesma");

    expect(await listCounterpartyLinks(db)).toEqual({});
  });

  it("limpar devolve a contraparte ao palpite automatico", async () => {
    await setCounterpartyLink(db, "curta", null);
    await clearCounterpartyLink(db, "curta");

    expect(await listCounterpartyLinks(db)).toEqual({});
  });
});

describe("taxonomia de centros de custo", () => {
  // A lista foi enxugada de dezesseis para dez: categoria que ninguem usa nao
  // ajuda a classificar, atrapalha.
  it("nasce com as dez categorias de despesa escolhidas, e so elas", async () => {
    const despesas = (await listCategorias(db))
      .filter((c) => c.kind === "despesa")
      .map((c) => c.name)
      .sort();

    expect(despesas).toEqual([
      "Alimentacao",
      "Compras",
      "Educacao",
      "Lazer e Cultura",
      "Moradia",
      "Presentes, Doacoes e Transferencias",
      "Saude",
      "Servicos domesticos",
      "Transporte",
      "Viagens",
    ]);
  });

  // Renda e Movimentacao nao sao gasto: some-las a lista de despesa seria dizer
  // que salario e um tipo de gasto.
  it("mantem renda e movimentacao fora das categorias de despesa", async () => {
    const tipos = new Map((await listCategorias(db)).map((c) => [c.name, c.kind]));

    expect(tipos.get("Renda")).toBe("receita");
    expect(tipos.get("Movimentacao")).toBe("movimentacao");
  });

  it("cada categoria diz o que entra nela", async () => {
    const moradia = (await listCategorias(db)).find((c) => c.name === "Moradia");

    expect(moradia?.hint).toContain("condominio");
  });

  // Duas grafias da mesma categoria era exatamente como o texto livre se
  // degradava; o indice unico sem caixa impede.
  it("nao cria categoria duplicada por diferenca de caixa", async () => {
    const a = await acharOuCriarCategoria(db, "Obras");
    const b = await acharOuCriarCategoria(db, "obras");

    expect(a).toBe(b);
    expect((await listCategorias(db)).filter((c) => /obras/i.test(c.name))).toHaveLength(1);
  });

  it("o mesmo nome de centro pode existir em categorias diferentes", async () => {
    // "Pai" faz sentido em Familia e em Saude ao mesmo tempo.
    const familia = (await acharOuCriarCategoria(db, "Presentes, Doacoes e Transferencias"))!;
    const saude = (await acharOuCriarCategoria(db, "Saude"))!;

    const a = await acharOuCriarCentroDeCusto(db, familia, "Pai");
    const b = await acharOuCriarCentroDeCusto(db, saude, "Pai");

    expect(a).not.toBe(b);
  });

  it("guarda orcamento e periodo do centro", async () => {
    const viagem = (await acharOuCriarCategoria(db, "Viagens"))!;
    const id = (await acharOuCriarCentroDeCusto(db, viagem, "Bariloche"))!;

    await salvarCentroDeCusto(db, id, {
      name: "Bariloche 2026",
      note: "ferias de julho",
      startsOn: "2026-07-10",
      endsOn: "2026-07-20",
      budget: 25000,
    });

    const centro = (await listCentrosDeCusto(db)).find((c) => c.id === id);
    expect(centro?.name).toBe("Bariloche 2026");
    expect(centro?.budget).toBe(25000);
    expect(centro?.startsOn).toBe("2026-07-10");
    expect(centro?.endsOn).toBe("2026-07-20");
  });

  // Nomes inventados de proposito: os da taxonomia real mudam quando o usuario
  // reorganiza as categorias, e o teste passaria a falhar por isso.
  it("renomear a categoria vale para todo o historico de uma vez", async () => {
    const id = (await acharOuCriarCategoria(db, "Nautica"))!;
    await salvarCategoria(db, id, { name: "Nautica e vela" });

    const nomes = (await listCategorias(db)).map((c) => c.name);
    expect(nomes).toContain("Nautica e vela");
    expect(nomes).not.toContain("Nautica");
  });

  it("nome vazio nao apaga o nome existente", async () => {
    const id = (await acharOuCriarCategoria(db, "Apicultura"))!;
    await salvarCategoria(db, id, { name: "   " });

    expect((await listCategorias(db)).map((c) => c.name)).toContain("Apicultura");
  });

  // Apagar levaria junto a classificacao feita a mao; arquivar so tira da lista.
  it("centro arquivado some da listagem mas continua no banco", async () => {
    const viagem = (await acharOuCriarCategoria(db, "Viagens"))!;
    const id = (await acharOuCriarCentroDeCusto(db, viagem, "Campos do Jordao"))!;

    await arquivarCentroDeCusto(db, id);
    expect((await listCentrosDeCusto(db)).map((c) => c.id)).not.toContain(id);
    expect((await listCentrosDeCusto(db, true)).map((c) => c.id)).toContain(id);
  });

  it("ignora id que nem uuid e, em vez de estourar", async () => {
    await expect(salvarCategoria(db, "../etc/passwd", { name: "x" })).resolves.toBeUndefined();
  });
});
