import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTransactions, nextQuery, resetApiKeyCache } from "../client";

/**
 * Forma real da paginacao da v2, confirmada contra a API: a resposta traz
 * `next` como query string pronta ("?accountId=...&after=<token>") ou null.
 */
const PAGINA = 500;

function transacao(indice: number, dia: string) {
  return {
    id: `tx-${indice}`,
    accountId: "conta-1",
    description: "lancamento",
    amount: -10,
    currencyCode: "BRL",
    date: `${dia}T15:00:00.000Z`,
  };
}

let chamadas: string[] = [];

function responder(corpo: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    text: async () => JSON.stringify(corpo),
    headers: new Headers(),
  } as unknown as Response;
}

beforeEach(() => {
  process.env.PLUGGY_CLIENT_ID = "id";
  process.env.PLUGGY_CLIENT_SECRET = "secret";
  process.env.PLUGGY_API_URL = "https://api.pluggy.ai";
  resetApiKeyCache();
  chamadas = [];
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Encadeia paginas: cada uma devolve `next` ate a ultima. */
function apiComPaginas(paginas: { itens: ReturnType<typeof transacao>[]; next: string | null }[]) {
  let indice = 0;

  vi.stubGlobal("fetch", async (entrada: URL | string) => {
    const url = String(entrada);
    if (url.endsWith("/auth")) return responder({ apiKey: "chave" });

    chamadas.push(url);
    const pagina = paginas[Math.min(indice, paginas.length - 1)];
    indice += 1;
    return responder({ results: pagina.itens, next: pagina.next });
  });
}

describe("nextQuery", () => {
  it("reconhece a query string de continuacao", () => {
    expect(nextQuery({ next: "?accountId=abc&after=xyz" })).toBe("?accountId=abc&after=xyz");
  });

  it("trata null como fim da paginacao", () => {
    expect(nextQuery({ next: null })).toBeNull();
    expect(nextQuery({})).toBeNull();
    expect(nextQuery(null)).toBeNull();
  });
});

describe("getTransactions", () => {
  it("segue o next ate acabar", async () => {
    apiComPaginas([
      { itens: [transacao(1, "2026-08-20")], next: "?accountId=conta-1&after=token1" },
      { itens: [transacao(2, "2026-08-15")], next: "?accountId=conta-1&after=token2" },
      { itens: [transacao(3, "2026-08-10")], next: null },
    ]);

    const resultado = await getTransactions("conta-1", { from: "2026-08-01", to: "2026-08-31" });

    expect(resultado).toHaveLength(3);
    expect(chamadas).toHaveLength(3);
    expect(chamadas[1]).toContain("after=token1");
    expect(chamadas[2]).toContain("after=token2");
  });

  // Este e o bug que estava truncando Nubank e Itau: sem seguir o next, cada
  // conta parava nos 500 lancamentos da primeira pagina.
  it("nao para na primeira pagina cheia", async () => {
    const cheia = Array.from({ length: PAGINA }, (_, i) => transacao(i, "2026-08-20"));
    apiComPaginas([
      { itens: cheia, next: "?accountId=conta-1&after=token" },
      { itens: [transacao(999, "2026-08-19")], next: null },
    ]);

    const resultado = await getTransactions("conta-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(resultado).toHaveLength(PAGINA + 1);
  });

  it("nunca envia um parametro cursor", async () => {
    apiComPaginas([
      { itens: [transacao(1, "2026-08-20")], next: "?accountId=conta-1&after=token" },
      { itens: [transacao(2, "2026-08-19")], next: null },
    ]);

    await getTransactions("conta-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(chamadas.some((url) => url.includes("cursor="))).toBe(false);
  });

  it("para de paginar ao alcancar o inicio da janela", async () => {
    apiComPaginas([
      { itens: [transacao(1, "2026-08-20")], next: "?accountId=conta-1&after=t1" },
      { itens: [transacao(2, "2026-07-15")], next: "?accountId=conta-1&after=t2" },
      { itens: [transacao(3, "2026-06-01")], next: null },
    ]);

    const resultado = await getTransactions("conta-1", { from: "2026-08-01", to: "2026-08-31" });

    // Buscou duas paginas e parou: a segunda ja trouxe algo anterior a janela.
    expect(chamadas).toHaveLength(2);
    expect(resultado.map((t) => t.id)).toEqual(["tx-1"]);
  });

  it("para quando a pagina vem vazia", async () => {
    apiComPaginas([{ itens: [], next: "?accountId=conta-1&after=t1" }]);
    const resultado = await getTransactions("conta-1", {});
    expect(resultado).toHaveLength(0);
    expect(chamadas).toHaveLength(1);
  });

  it("recorta o periodo em codigo, ja que a v2 recusa filtro de data", async () => {
    apiComPaginas([
      {
        itens: [transacao(1, "2026-08-20"), transacao(2, "2026-09-05")],
        next: null,
      },
    ]);

    const resultado = await getTransactions("conta-1", { from: "2026-08-01", to: "2026-08-31" });
    expect(resultado.map((t) => t.id)).toEqual(["tx-1"]);
  });
});
