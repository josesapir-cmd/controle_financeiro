import { beforeEach, describe, expect, it } from "vitest";
import { resetKeyCache } from "@/lib/crypto";
import {
  doFormulario,
  identidade,
  mesclar,
  suspeitasDeDuplicata,
  totalDeSaidas,
  validar,
  type Linha,
} from "../linhas";

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

/** Le um envio e o mescla ao que ja havia, como a rota faz. */
function envio(anteriores: Linha[], brutas: Record<string, unknown>[], numero: number): Linha[] {
  const { linhas } = validar(brutas, { envio: numero, arquivos: [`IMG_0${numero}.png`] });
  return mesclar(anteriores, linhas);
}

describe("validar", () => {
  it("aplica o sinal do app a partir do tipo, nao do sinal lido", () => {
    const { linhas } = validar([bruta(), bruta({ tipo: "entrada", valor: 50 })], {
      envio: 1,
      arquivos: [],
    });

    expect(linhas.map((l) => l.valor)).toEqual([-129.9, 50]);
  });

  it("ignora o sinal que o modelo escrever no valor", () => {
    // Confiar no sinal seria confiar duas vezes na mesma leitura: a magnitude
    // vem do valor, o sentido vem do tipo.
    const { linhas } = validar([bruta({ valor: -129.9, tipo: "despesa" })], {
      envio: 1,
      arquivos: [],
    });

    expect(linhas[0].valor).toBe(-129.9);
  });

  it("rejeita linha sem data valida, sem descricao ou sem valor", () => {
    const { linhas, rejeitadas } = validar(
      [bruta({ data: "12 de maio" }), bruta({ descricao: "   " }), bruta({ valor: 0 }), bruta({ valor: "abc" })],
      { envio: 1, arquivos: [] },
    );

    expect(linhas).toHaveLength(0);
    expect(rejeitadas.map((r) => r.motivo)).toEqual([
      "Data ilegivel",
      "Sem descricao",
      "Valor ilegivel",
      "Valor ilegivel",
    ]);
  });

  it("guarda de qual envio e de quais arquivos a linha veio", () => {
    const { linhas } = validar([bruta()], { envio: 3, arquivos: ["a.png", "b.png"] });

    expect(linhas[0].envio).toBe(3);
    expect(linhas[0].arquivos).toEqual(["a.png", "b.png"]);
  });

  it("trata confianca desconhecida como baixa", () => {
    const { linhas } = validar([bruta({ confianca: "otima" })], { envio: 1, arquivos: [] });

    expect(linhas[0].confianca).toBe("baixa");
  });
});

describe("mesclar", () => {
  it("da identidade estavel a mesma linha, para reenviar o print nao duplicar", () => {
    const primeira = envio([], [bruta()], 1);
    const segunda = envio([], [bruta()], 1);

    expect(primeira[0].id).toBe(segunda[0].id);
  });

  it("nao colapsa dois gastos identicos lidos no mesmo envio", () => {
    // Dentro de um envio o modelo viu as duas telas juntas: se listou duas
    // vezes, sao dois gastos. O print nao traz horario, entao o indice de
    // ocorrencia e o que os mantem separados.
    const linhas = envio([], [bruta({ descricao: "Uber", valor: 20 }), bruta({ descricao: "Uber", valor: 20 })], 1);

    expect(linhas).toHaveLength(2);
    expect(linhas[0].id).not.toBe(linhas[1].id);
    expect(linhas.map((l) => l.ocorrencia)).toEqual([1, 2]);
    expect(linhas.every((l) => !l.duplicada)).toBe(true);
  });

  it("marca como possivel repeticao a linha igual vinda de outro envio", () => {
    const primeiro = envio([], [bruta()], 1);
    const segundo = envio(primeiro, [bruta()], 2);

    expect(segundo).toHaveLength(2);
    expect(segundo.map((l) => l.duplicada)).toEqual([false, true]);
    expect(suspeitasDeDuplicata(segundo)).toHaveLength(1);
  });

  it("nao descarta a repetida: quem viu as telas e que decide", () => {
    // Apagar em silencio tira dinheiro do controle sem ninguem perceber — e o
    // caso "dois cafes iguais na mesma padaria" e indistinguivel daqui.
    const segundo = envio(envio([], [bruta()], 1), [bruta()], 2);

    expect(segundo.map((l) => l.ocorrencia)).toEqual([1, 2]);
    expect(new Set(segundo.map((l) => l.id)).size).toBe(2);
  });

  it("nao marca repeticao quando muda a data, o valor ou a contraparte", () => {
    const primeiro = envio([], [bruta()], 1);
    const segundo = envio(primeiro, [bruta({ valor: 130 }), bruta({ data: "2026-05-13" }), bruta({ descricao: "Outro" })], 2);

    expect(suspeitasDeDuplicata(segundo)).toHaveLength(0);
  });

  it("compara ignorando acento e espaco repetido", () => {
    const primeiro = envio([], [bruta({ descricao: "Padaria  Sao   Joao" })], 1);
    const segundo = envio(primeiro, [bruta({ descricao: "PADARIA SAO JOAO" })], 2);

    expect(suspeitasDeDuplicata(segundo)).toHaveLength(1);
  });

  it("preserva a descricao original para exibicao", () => {
    const linhas = envio([], [bruta({ descricao: "  Padaria Sao Joao  " })], 1);

    expect(linhas[0].descricao).toBe("Padaria Sao Joao");
  });

  it("ordena por dia", () => {
    const linhas = envio([], [bruta({ data: "2026-05-20" }), bruta({ data: "2026-05-02" })], 1);

    expect(linhas.map((l) => l.dia)).toEqual(["2026-05-02", "2026-05-20"]);
  });
});

describe("doFormulario", () => {
  const campos = {
    dia: "2026-05-12",
    descricao: "Mercado Sao Jose",
    valor: 129.9,
    tipo: "despesa",
    confianca: "alta",
    ocorrencia: 2,
  };

  it("respeita a ocorrencia vinda do formulario em vez de recontar", () => {
    // Recontar mudaria o id de uma linha so porque a identica ao lado foi
    // desmarcada — e a linha ja gravada viraria orfa.
    expect(doFormulario(campos)?.id).toBe(identidade("2026-05-12", 129.9, "Mercado Sao Jose", 2));
  });

  it("recalcula a identidade sobre o valor corrigido pelo usuario", () => {
    const original = doFormulario({ ...campos, ocorrencia: 1 });
    const corrigida = doFormulario({ ...campos, valor: 132.5, ocorrencia: 1 });

    expect(corrigida?.id).not.toBe(original?.id);
  });

  it("devolve null para correcao invalida, em vez de gravar lixo", () => {
    expect(doFormulario({ ...campos, valor: Number.NaN })).toBeNull();
    expect(doFormulario({ ...campos, dia: "ontem" })).toBeNull();
    expect(doFormulario({ ...campos, descricao: "  " })).toBeNull();
  });

  it("cai em ocorrencia 1 quando o campo vem corrompido", () => {
    expect(doFormulario({ ...campos, ocorrencia: Number.NaN })?.ocorrencia).toBe(1);
    expect(doFormulario({ ...campos, ocorrencia: -3 })?.ocorrencia).toBe(1);
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
    const linhas = envio(
      [],
      [
        bruta({ valor: 100 }),
        bruta({ valor: 50, tipo: "entrada", descricao: "Estorno" }),
        bruta({ valor: 25, descricao: "Farmacia" }),
      ],
      1,
    );

    expect(totalDeSaidas(linhas)).toBe(125);
  });
});
