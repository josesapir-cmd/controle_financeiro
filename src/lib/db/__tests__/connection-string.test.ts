import { describe, expect, it } from "vitest";
import { normalizeConnectionString } from "../connection-string.mjs";

const BASE = "postgresql://usuario:senha@ep-abc.sa-east-1.aws.neon.tech/neondb";

describe("normalizeConnectionString", () => {
  // O Neon entrega a string com channel_binding; o driver a repassaria ao
  // servidor como parametro de conexao e a conexao seria recusada.
  it("remove channel_binding, que o driver nao conhece", () => {
    const resultado = normalizeConnectionString(
      `${BASE}?sslmode=require&channel_binding=require`,
    );
    expect(resultado).not.toContain("channel_binding");
  });

  it("preserva sslmode", () => {
    const resultado = normalizeConnectionString(`${BASE}?sslmode=require&channel_binding=require`);
    expect(resultado).toContain("sslmode=require");
  });

  it("preserva usuario, senha, host e banco", () => {
    const resultado = new URL(normalizeConnectionString(`${BASE}?channel_binding=require`));
    expect(resultado.username).toBe("usuario");
    expect(resultado.password).toBe("senha");
    expect(resultado.hostname).toBe("ep-abc.sa-east-1.aws.neon.tech");
    expect(resultado.pathname).toBe("/neondb");
  });

  it("deixa intacta uma string que ja esta limpa", () => {
    expect(normalizeConnectionString(`${BASE}?sslmode=require`)).toContain("sslmode=require");
  });

  it("devolve como veio o que nao for URL valida", () => {
    expect(normalizeConnectionString("nao-e-url")).toBe("nao-e-url");
  });
});
