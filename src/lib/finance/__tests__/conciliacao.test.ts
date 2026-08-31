import { describe, expect, it } from "vitest";
import { NAO_IDENTIFICADA } from "../counterparties";
import {
  chaveEfetiva,
  mapaDeConciliacao,
  sugerirConciliacoes,
  type Candidata,
} from "../conciliacao";

function candidata(nome: string, extra: Partial<Candidata> = {}): Candidata {
  return { key: nome, name: nome, hasDocument: false, count: 1, ...extra };
}

const RECORTADA = candidata("HOTEL FAZENDA CASC", { key: "curta" });
const COMPLETA = candidata("HOTEL FAZENDA CASCATINHA LTDA", {
  key: "longa",
  hasDocument: true,
  count: 12,
});

describe("sugerirConciliacoes", () => {
  it("une o nome recortado do print ao nome completo do Open Finance", () => {
    const [sugestao] = sugerirConciliacoes([RECORTADA, COMPLETA]);

    expect(sugestao.de).toBe("curta");
    expect(sugestao.para).toBe("longa");
    expect(sugestao.automatica).toBe(true);
  });

  it("nao dobra contraparte com documento dentro de um casamento de nome", () => {
    // Documento e identidade forte; nome e fraca. Trocar uma pela outra seria
    // regressao, mesmo que o prefixo bata.
    const comDocumento = candidata("HOTEL FAZENDA CASC", { key: "curta", hasDocument: true });

    expect(sugerirConciliacoes([comDocumento, COMPLETA])).toHaveLength(0);
  });

  it("nao arrisca prefixo curto, que colide facil", () => {
    const curta = candidata("PADARIA", { key: "curta" });
    const longa = candidata("PADARIA SAO JOAO LTDA", { key: "longa" });

    expect(sugerirConciliacoes([curta, longa])).toHaveLength(0);
  });

  it("aceita prefixo menor quando o proprio texto diz que foi cortado", () => {
    const curta = candidata("MERCADIN...", { key: "curta" });
    const longa = candidata("MERCADINHO DA ESQUINA", { key: "longa" });
    const [sugestao] = sugerirConciliacoes([curta, longa]);

    expect(sugestao?.para).toBe("longa");
    expect(sugestao.motivo).toContain("cortado");
  });

  it("sugere sem aplicar quando o prefixo serve a mais de um nome", () => {
    // Escolher no chute misturaria o gasto de dois lugares diferentes.
    const curta = candidata("SUPERMERCADO PAG", { key: "curta" });
    const a = candidata("SUPERMERCADO PAGUE MENOS", { key: "a" });
    const b = candidata("SUPERMERCADO PAGUE BEM", { key: "b" });

    const [sugestao] = sugerirConciliacoes([curta, a, b]);

    expect(sugestao.automatica).toBe(false);
    expect(sugestao.motivo).toContain("2 nomes diferentes");
  });

  it("ignora acento e caixa na comparacao", () => {
    const curta = candidata("padaria são joão", { key: "curta" });
    const longa = candidata("PADARIA SAO JOAO LTDA ME", { key: "longa" });

    expect(sugerirConciliacoes([curta, longa])).toHaveLength(1);
  });

  it("nao mexe na contraparte nao identificada", () => {
    const anonima = candidata("qualquer coisa", { key: NAO_IDENTIFICADA });
    const longa = candidata("qualquer coisa mais longa", { key: "longa" });

    expect(sugerirConciliacoes([anonima, longa])).toHaveLength(0);
  });

  it("respeita a decisao de que sao diferentes", () => {
    expect(sugerirConciliacoes([RECORTADA, COMPLETA], { curta: null })).toHaveLength(0);
  });

  it("nao sugere de novo o que ja foi decidido", () => {
    expect(sugerirConciliacoes([RECORTADA, COMPLETA], { curta: "longa" })).toHaveLength(0);
  });

  it("nao sugere nada quando os nomes sao independentes", () => {
    const a = candidata("PADARIA SAO JOAO", { key: "a" });
    const b = candidata("POSTO IPIRANGA CENTRO", { key: "b" });

    expect(sugerirConciliacoes([a, b])).toHaveLength(0);
  });
});

describe("mapaDeConciliacao", () => {
  it("aplica so o que e automatico", () => {
    const sugestoes = [
      { de: "a", para: "b", nomeDe: "a", nomePara: "b", automatica: true, motivo: "" },
      { de: "c", para: "d", nomeDe: "c", nomePara: "d", automatica: false, motivo: "" },
    ];

    expect(mapaDeConciliacao(sugestoes)).toEqual({ a: "b" });
  });

  it("a decisao do usuario vence a sugestao automatica", () => {
    const sugestoes = [
      { de: "a", para: "b", nomeDe: "a", nomePara: "b", automatica: true, motivo: "" },
    ];

    expect(mapaDeConciliacao(sugestoes, { a: "z" })).toEqual({ a: "z" });
    expect(mapaDeConciliacao(sugestoes, { a: null })).toEqual({});
  });

  it("resolve cadeia ate o fim", () => {
    expect(mapaDeConciliacao([], { a: "b", b: "c" })).toEqual({ a: "c", b: "c" });
  });

  // Duas decisoes apontando uma para a outra sao contraditorias: nao ha destino
  // final. Nenhuma uniao e aplicada — e nada trava.
  it("desiste da uniao quando as decisoes formam ciclo, sem entrar em laco", () => {
    expect(mapaDeConciliacao([], { a: "b", b: "a" })).toEqual({});
  });
});

describe("chaveEfetiva", () => {
  it("devolve o destino quando ha uniao e a propria chave quando nao ha", () => {
    expect(chaveEfetiva("a", { a: "b" })).toBe("b");
    expect(chaveEfetiva("x", { a: "b" })).toBe("x");
  });
});
