import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import { identidade, normalizar, totalDeSaidas } from "../linhas";

// A identidade das linhas e um HMAC, entao os testes precisam de chave.
beforeEach(() => {
  process.env.APP_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  resetKeyCache();
});

/** Uma leitura crua qualquer, com os campos que o modelo devolve. */
function bruta(extra: Record<string, unknown> = {}) {
  return {
    data: "2026-05-12",
    descricao: "Mercado Sao Jose",
    valor: 129.9,
    tipo: "despesa",
    confianca: "alta",
    ...extra,
  };
}

describe("normalizar", () => {
  it("aplica o sinal do app a partir do tipo, nao do sinal lido", () => {
    const { linhas } = normalizar([bruta(), bruta({ tipo: "entrada", valor: 50 })]);

    expect(linhas.map((l) => l.valor)).toEqual([-129.9, 50]);
  });

  it("ignora o sinal que o modelo escrever no valor", () => {
    // Confiar no sinal seria confiar duas vezes na mesma leitura: a magnitude
    // vem do valor, o sentido vem do tipo.
    const { linhas } = normalizar([bruta({ valor: -129.9, tipo: "despesa" })]);

    expect(linhas[0].valor).toBe(-129.9);
  });

  it("rejeita linha sem data valida, sem descricao ou sem valor", () => {
    const { linhas, rejeitadas } = normalizar([
      bruta({ data: "12 de maio" }),
      bruta({ descricao: "   " }),
      bruta({ valor: 0 }),
      bruta({ valor: "abc" }),
    ]);

    expect(linhas).toHaveLength(0);
    expect(rejeitadas.map((r) => r.motivo)).toEqual([
      "Data ilegivel",
      "Sem descricao",
      "Valor ilegivel",
      "Valor ilegivel",
    ]);
  });

  it("da identidade estavel a mesma linha, para reenviar o print nao duplicar", () => {
    const primeira = normalizar([bruta()]);
    const segunda = normalizar([bruta()]);

    expect(primeira.linhas[0].id).toBe(segunda.linhas[0].id);
  });

  it("nao colapsa dois gastos identicos no mesmo dia", () => {
    // O print nao traz horario: sem o indice de ocorrencia, a segunda corrida de
    // R$ 20 sumiria dentro da primeira.
    const { linhas } = normalizar([
      bruta({ descricao: "Uber", valor: 20 }),
      bruta({ descricao: "Uber", valor: 20 }),
    ]);

    expect(linhas).toHaveLength(2);
    expect(linhas[0].id).not.toBe(linhas[1].id);
  });

  it("trata acentuacao e espacos como a mesma descricao ao comparar", () => {
    const comAcento = normalizar([bruta({ descricao: "Padaria  Sao   Joao" })]);
    const semAcento = normalizar([bruta({ descricao: "PADARIA SAO JOAO" })]);

    expect(comAcento.linhas[0].id).toBe(semAcento.linhas[0].id);
  });

  it("preserva a descricao original para exibicao", () => {
    const { linhas } = normalizar([bruta({ descricao: "  Padaria Sao Joao  " })]);

    expect(linhas[0].descricao).toBe("Padaria Sao Joao");
  });

  it("trata confianca desconhecida como baixa", () => {
    const { linhas } = normalizar([bruta({ confianca: "otima" })]);

    expect(linhas[0].confianca).toBe("baixa");
  });

  it("ordena por dia", () => {
    const { linhas } = normalizar([
      bruta({ data: "2026-05-20" }),
      bruta({ data: "2026-05-02" }),
    ]);

    expect(linhas.map((l) => l.dia)).toEqual(["2026-05-02", "2026-05-20"]);
  });
});

describe("identidade", () => {
  it("nao vaza a descricao: e um hash com prefixo reconhecivel", () => {
    const id = identidade("2026-05-12", 129.9, "Mercado Sao Jose", 1);

    expect(id.startsWith("print:")).toBe(true);
    expect(id).not.toContain("Mercado");
  });

  it("muda quando o valor muda", () => {
    expect(identidade("2026-05-12", 129.9, "Mercado", 1)).not.toBe(
      identidade("2026-05-12", 130, "Mercado", 1),
    );
  });
});

describe("totalDeSaidas", () => {
  it("soma so as saidas, como numero positivo", () => {
    const { linhas } = normalizar([
      bruta({ valor: 100 }),
      bruta({ valor: 50, tipo: "entrada", descricao: "Estorno" }),
      bruta({ valor: 25, descricao: "Farmacia" }),
    ]);

    expect(totalDeSaidas(linhas)).toBe(125);
  });
});
