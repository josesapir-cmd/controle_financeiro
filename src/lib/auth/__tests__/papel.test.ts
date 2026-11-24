import { PGlite } from "@electric-sql/pglite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { migrate } from "@/lib/db/migrate.mjs";

/**
 * Dono e assistente, de ponta a ponta no que nao depende do navegador:
 * credencial, sessao, guarda, convite e revogacao — contra um Postgres de
 * verdade, com a migracao 027 aplicada.
 */

const estado = vi.hoisted(() => ({
  pg: null as unknown as PGlite,
  cookies: new Map<string, string>(),
}));

vi.mock("@/lib/db/client", () => ({
  getSql: () => ({
    unsafe: async (texto: string, params?: unknown[]) =>
      (await estado.pg.query(texto, params as unknown[])).rows,
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (estado.cookies.has(k) ? { value: estado.cookies.get(k)! } : undefined),
    set: (k: string, v: string) => void estado.cookies.set(k, v),
    delete: (k: string) => void estado.cookies.delete(k),
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    throw new Error(`REDIRECT ${destino}`);
  },
}));

const credenciais = await import("../credentials");
const sessao = await import("../session");
const guarda = await import("../guard");
const registro = await import("../registro");

async function credencial(id: string, papel: "dono" | "assistente") {
  await credenciais.saveCredential({ id, publicKey: new Uint8Array([1, 2, 3]), counter: 0, papel });
}

async function entrarComo(papel: "dono" | "assistente") {
  estado.cookies.clear();
  await sessao.createSession("teste", papel);
}

beforeEach(async () => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
  const { resetKeyCache } = await import("@/lib/crypto");
  resetKeyCache();

  estado.pg = new PGlite();
  estado.cookies.clear();
  await migrate({
    async unsafe(query: string) {
      const r = await estado.pg.exec(query);
      return r[r.length - 1]?.rows ?? [];
    },
  });
});

describe("migracao 027 aplicada", () => {
  it("e reconhecida", async () => {
    expect(await credenciais.papelNoBanco()).toBe(true);
  });
});

describe("guarda por papel", () => {
  it("sem sessao, vai para a entrada", async () => {
    await expect(guarda.requireSession()).rejects.toThrow("REDIRECT /entrar");
    await expect(guarda.requireAcessoDaAssistente()).rejects.toThrow("REDIRECT /entrar");
  });

  it("o dono passa pelas duas guardas", async () => {
    await entrarComo("dono");
    await expect(guarda.requireSession()).resolves.toBeUndefined();
    await expect(guarda.requireAcessoDaAssistente()).resolves.toBe("dono");
  });

  it("a assistente e mandada para a tela dela em qualquer pagina do dono", async () => {
    await entrarComo("assistente");
    await expect(guarda.requireSession()).rejects.toThrow("REDIRECT /assistente");
    await expect(guarda.requireAcessoDaAssistente()).resolves.toBe("assistente");
  });

  it("sessao criada sem papel falha no banco, em vez de virar dono", async () => {
    await expect(
      estado.pg.query("INSERT INTO sessions (id, expires_at) VALUES ('x', now() + interval '1 day')"),
    ).rejects.toThrow();
  });

  it("o papel vem da credencial e nao muda ao registrar a mesma de novo", async () => {
    await credencial("c1", "assistente");
    await credencial("c1", "dono");
    const [c] = await credenciais.listCredentials();
    expect(c.papel).toBe("assistente");
  });
});

describe("convite da assistente", () => {
  it("vale uma vez, e conferir nao gasta", async () => {
    const codigo = await credenciais.createAssistantInvite();
    expect(codigo).toMatch(/^[A-Z2-9]{8}$/);

    expect(await credenciais.codigoValido("convite", codigo.toLowerCase())).toBe(true);
    expect(await credenciais.codigoValido("convite", ` ${codigo.slice(0, 4)}-${codigo.slice(4)} `)).toBe(true);
    expect(await credenciais.consumirCodigo("convite", codigo)).toBe(true);
    expect(await credenciais.consumirCodigo("convite", codigo)).toBe(false);
    expect(await credenciais.codigoValido("convite", codigo)).toBe(false);
  });

  it("um convite novo invalida o anterior", async () => {
    const antigo = await credenciais.createAssistantInvite();
    const novo = await credenciais.createAssistantInvite();
    expect(await credenciais.codigoValido("convite", antigo)).toBe(false);
    expect(await credenciais.codigoValido("convite", novo)).toBe(true);
  });

  it("codigo de dispositivo nao serve de convite, nem o contrario", async () => {
    const dispositivo = await credenciais.createDeviceCode();
    const convite = await credenciais.createAssistantInvite();
    expect(await credenciais.codigoValido("convite", dispositivo)).toBe(false);
    expect(await credenciais.codigoValido("dispositivo", convite)).toBe(false);
  });

  it("revogar tira passkey e sessao da assistente, e nada do dono", async () => {
    await credencial("dono-1", "dono");
    await credencial("assist-1", "assistente");
    await entrarComo("dono");
    const cookieDoDono = new Map(estado.cookies);
    await entrarComo("assistente");
    await credenciais.createAssistantInvite();

    await credenciais.revokeAssistant();

    expect(await sessao.currentSession()).toBeNull();
    expect((await credenciais.listCredentials()).map((c) => c.id)).toEqual(["dono-1"]);
    expect(await credenciais.pendingAssistantInvite()).toBeNull();

    estado.cookies = cookieDoDono;
    expect((await sessao.currentSession())?.papel).toBe("dono");
  });
});

describe("registro de passkey", () => {
  it("bootstrap so enquanto nao ha credencial", async () => {
    expect(await registro.autorizarRegistro()).toEqual({ tipo: "bootstrap" });
    await credencial("dono-1", "dono");
    expect(await registro.autorizarRegistro()).toBeNull();
    // Outra aba fez o bootstrap entre as duas etapas: a segunda recusa.
    expect(await registro.concluirRegistro("registro:bootstrap")).toBeNull();
  });

  it("convite registra assistente, consumido so na segunda etapa", async () => {
    await credencial("dono-1", "dono");
    const codigo = await credenciais.createAssistantInvite();

    const concessao = await registro.autorizarRegistro(codigo);
    expect(concessao?.tipo).toBe("convite");
    // A primeira etapa nao gasta: biometria cancelada nao queima o convite.
    expect(await credenciais.codigoValido("convite", codigo)).toBe(true);

    const proposito = registro.propositoDoRegistro(concessao!);
    expect(await registro.concluirRegistro(proposito)).toBe("assistente");
    expect(await registro.concluirRegistro(proposito)).toBeNull();
  });

  it("codigo digitado vence a sessao do dono aberta no mesmo navegador", async () => {
    // O caso que importa: a assistente cria a passkey dela no computador onde
    // o dono esta logado. Sem esta regra, ela sairia com passkey de DONO.
    await credencial("dono-1", "dono");
    await entrarComo("dono");
    const codigo = await credenciais.createAssistantInvite();

    const concessao = await registro.autorizarRegistro(codigo);
    expect(concessao?.tipo).toBe("convite");
    expect(await registro.concluirRegistro(registro.propositoDoRegistro(concessao!))).toBe(
      "assistente",
    );
  });

  it("codigo errado nao cai para a sessao", async () => {
    await credencial("dono-1", "dono");
    await entrarComo("dono");
    expect(await registro.autorizarRegistro("ERRADO99")).toBeNull();
  });

  it("sessao da assistente nao registra nada sem convite", async () => {
    await credencial("dono-1", "dono");
    await entrarComo("assistente");
    expect(await registro.autorizarRegistro()).toBeNull();
    expect(await registro.concluirRegistro("registro:sessao")).toBeNull();
  });

  it("codigo de dispositivo registra dono, e agora chega ao fim", async () => {
    // Antes, a primeira etapa gastava o codigo e a segunda o procurava de
    // novo: adicionar dispositivo falhava sempre na verificacao.
    await credencial("dono-1", "dono");
    const codigo = await credenciais.createDeviceCode();

    const concessao = await registro.autorizarRegistro(codigo);
    expect(concessao?.tipo).toBe("dispositivo");
    expect(await registro.concluirRegistro(registro.propositoDoRegistro(concessao!))).toBe("dono");
  });

  it("o aparelho do dono pode receber a passkey da assistente, mas nao uma segunda dela", () => {
    const existentes = [
      { id: "do-dono", papel: "dono" as const },
      { id: "da-assistente", papel: "assistente" as const },
    ];
    expect(registro.credenciaisAExcluir(existentes, { tipo: "convite", codigo: "X" })).toEqual([
      { id: "da-assistente" },
    ]);
    expect(registro.credenciaisAExcluir(existentes, { tipo: "sessao" })).toEqual([
      { id: "do-dono" },
    ]);
  });

  it("proposito forjado nao concede nada", async () => {
    await credencial("dono-1", "dono");
    expect(await registro.concluirRegistro("registro:convite:NAOEXISTE")).toBeNull();
    expect(await registro.concluirRegistro("registro:qualquer")).toBeNull();
  });
});

describe("janela entre o deploy e a migracao 027", () => {
  it("sem a coluna de papel, o dono continua entrando", async () => {
    estado.pg = new PGlite();
    await migrate(
      {
        async unsafe(query: string) {
          const r = await estado.pg.exec(query);
          return r[r.length - 1]?.rows ?? [];
        },
      },
      () => {},
      { ate: "026_data_da_compra.sql" },
    );

    await estado.pg.query(
      "INSERT INTO credentials (id, public_key) VALUES ('antiga', '\\x010203'::bytea)",
    );
    const [c] = await credenciais.listCredentials();
    expect(c.papel).toBe("dono");

    await entrarComo("dono");
    expect((await sessao.currentSession())?.papel).toBe("dono");
  });

  it("o dono adiciona aparelho, e a falta da migracao e detectada antes do convite", async () => {
    estado.pg = new PGlite();
    await migrate(
      {
        async unsafe(query: string) {
          const r = await estado.pg.exec(query);
          return r[r.length - 1]?.rows ?? [];
        },
      },
      () => {},
      { ate: "026_data_da_compra.sql" },
    );

    expect(await credenciais.papelNoBanco()).toBe(false);
    await credencial("aparelho-novo", "dono");
    expect((await credenciais.listCredentials()).map((c) => c.papel)).toEqual(["dono"]);
    await expect(credencial("da-assistente", "assistente")).rejects.toThrow();
  });

  it("mas nao cria sessao de assistente antes da migracao", async () => {
    estado.pg = new PGlite();
    await migrate(
      {
        async unsafe(query: string) {
          const r = await estado.pg.exec(query);
          return r[r.length - 1]?.rows ?? [];
        },
      },
      () => {},
      { ate: "026_data_da_compra.sql" },
    );
    await expect(sessao.createSession("teste", "assistente")).rejects.toThrow();
  });
});
