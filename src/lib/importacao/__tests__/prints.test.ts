import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import { TAMANHO_DO_ENVIO, emBlocos, tipoAceito } from "../limites";
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
  const PROCEDENCIA = { envio: 1, arquivos: ["IMG_01.png"] };

  it("recusa envio vazio", async () => {
    await expect(
      lerPrints([], "2026-05-12", PROCEDENCIA, cliente({ linhas: [], observacao: "" })),
    ).rejects.toThrow(/Nenhuma imagem/);
  });

  it("valida o que o modelo devolve e separa o que nao passou", async () => {
    const leitura = await lerPrints(
      [IMAGEM],
      "2026-05-12",
      PROCEDENCIA,
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

  it("carimba a procedencia em cada linha, para a tela dizer de que print veio", async () => {
    const leitura = await lerPrints(
      [IMAGEM],
      "2026-05-12",
      { envio: 4, arquivos: ["IMG_09.png"] },
      cliente({
        linhas: [
          { data: "2026-05-12", descricao: "Mercado", valor: 100, tipo: "despesa", confianca: "alta" },
        ],
        observacao: "",
      }),
    );

    expect(leitura.linhas[0].envio).toBe(4);
    expect(leitura.linhas[0].arquivos).toEqual(["IMG_09.png"]);
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

describe("emBlocos", () => {
  it("quebra a selecao em blocos do tamanho de envio, preservando a ordem", () => {
    const blocos = emBlocos([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    expect(blocos.map((b) => b.length)).toEqual([TAMANHO_DO_ENVIO, TAMANHO_DO_ENVIO, 1]);
    expect(blocos.flat()).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("nao produz bloco vazio para selecao vazia", () => {
    expect(emBlocos([])).toEqual([]);
  });

  // Prints de rolagem sao consecutivos: manter vizinhos no mesmo bloco faz o
  // proprio modelo unir a sobreposicao, sem depender da deteccao posterior.
  it("mantem imagens vizinhas no mesmo bloco", () => {
    expect(emBlocos(["a", "b", "c"], 4)).toEqual([["a", "b", "c"]]);
  });
});
