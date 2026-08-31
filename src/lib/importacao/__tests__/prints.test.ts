import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import { MAXIMO_DE_IMAGENS, tipoAceito } from "../limites";
import { lerPrints, type ClienteDeLeitura } from "../prints";

beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString("base64");
  resetKeyCache();
});

const IMAGEM = { midia: "image/png", base64: "iVBORw0KGgo=" };

/** Cliente falso: os testes cobrem o contrato, nao a leitura do modelo. */
function cliente(resposta: Awaited<ReturnType<ClienteDeLeitura["ler"]>>): ClienteDeLeitura {
  return {
    async ler() {
      return resposta;
    },
  };
}

describe("lerPrints", () => {
  it("recusa envio vazio", async () => {
    await expect(lerPrints([], "2026-05-12", cliente({ linhas: [], observacao: "" }))).rejects.toThrow(
      /Nenhuma imagem/,
    );
  });

  it("recusa mais imagens do que o limite, antes de gastar uma chamada", async () => {
    const demais = Array.from({ length: MAXIMO_DE_IMAGENS + 1 }, () => IMAGEM);
    let chamou = false;
    const espiao: ClienteDeLeitura = {
      async ler() {
        chamou = true;
        return { linhas: [], observacao: "" };
      },
    };

    await expect(lerPrints(demais, "2026-05-12", espiao)).rejects.toThrow(/no maximo/);
    expect(chamou).toBe(false);
  });

  it("normaliza o que o modelo devolve e separa o que nao passou", async () => {
    const leitura = await lerPrints(
      [IMAGEM],
      "2026-05-12",
      cliente({
        linhas: [
          { data: "2026-05-12", descricao: "Mercado", valor: 100, tipo: "despesa", confianca: "alta" },
          { data: "ontem", descricao: "Farmacia", valor: 40, tipo: "despesa", confianca: "baixa" },
        ],
        observacao: "a ultima linha estava cortada",
      }),
    );

    expect(leitura.linhas.map((l) => l.valor)).toEqual([-100]);
    expect(leitura.rejeitadas).toHaveLength(1);
    expect(leitura.observacao).toBe("a ultima linha estava cortada");
  });
});

describe("tipoAceito", () => {
  it("aceita os formatos que a API de visao le", () => {
    expect(["image/png", "image/jpeg", "image/webp", "image/gif"].every(tipoAceito)).toBe(true);
  });

  it("recusa o que nao e imagem", () => {
    expect(tipoAceito("application/pdf")).toBe(false);
    expect(tipoAceito("text/csv")).toBe(false);
  });
});
