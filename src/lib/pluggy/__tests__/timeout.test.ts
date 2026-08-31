import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * O timeout e lido no carregamento do modulo, entao cada caso precisa de uma
 * importacao limpa.
 */
async function mensagemDeTimeout(valor: string | undefined): Promise<string> {
  vi.resetModules();

  if (valor === undefined) delete process.env.PLUGGY_TIMEOUT_MS;
  else process.env.PLUGGY_TIMEOUT_MS = valor;

  process.env.PLUGGY_CLIENT_ID = "id";
  process.env.PLUGGY_CLIENT_SECRET = "secret";

  const modulo = await import("../client");
  modulo.resetApiKeyCache();

  vi.stubGlobal("fetch", async () => {
    const erro = new Error("abortado");
    erro.name = "TimeoutError";
    throw erro;
  });

  try {
    await modulo.getTransactions("conta", {});
    return "sem erro";
  } catch (erro) {
    return erro instanceof Error ? erro.message : String(erro);
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PLUGGY_TIMEOUT_MS;
});

describe("timeout lido do ambiente", () => {
  it("usa o padrao quando a variavel nao existe", async () => {
    expect(await mensagemDeTimeout(undefined)).toContain("15s");
  });

  /**
   * O bug que derrubou a sincronizacao em producao por quatro dias: `??` nao
   * cobre string vazia, e Number("") e 0 — timeout de zero milissegundos aborta
   * toda chamada antes de sair.
   */
  it("usa o padrao quando a variavel existe porem vazia", async () => {
    expect(await mensagemDeTimeout("")).toContain("15s");
  });

  it("usa o padrao quando a variavel so tem espacos", async () => {
    expect(await mensagemDeTimeout("   ")).toContain("15s");
  });

  it("usa o padrao quando o valor nao e numero", async () => {
    expect(await mensagemDeTimeout("abc")).toContain("15s");
  });

  it("usa o padrao quando o valor e zero ou negativo", async () => {
    expect(await mensagemDeTimeout("0")).toContain("15s");
    expect(await mensagemDeTimeout("-5")).toContain("15s");
  });

  it("respeita um valor valido", async () => {
    expect(await mensagemDeTimeout("30000")).toContain("30s");
  });
});
