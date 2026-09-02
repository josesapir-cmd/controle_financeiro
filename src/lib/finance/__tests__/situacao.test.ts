import { describe, expect, it } from "vitest";
import { fronteiraDeDados, situacaoDoDia } from "../situacao";

const CONTAS = [{ id: "nubank" }, { id: "itau" }, { id: "btg" }];

describe("fronteiraDeDados", () => {
  it("e o menor ultimo-dia entre as contas", () => {
    // Dizer "pronto" no dia 31 porque o Nubank chegou ate la daria por
    // classificado um dia cuja metade do Itau nao chegou.
    const fronteira = fronteiraDeDados(
      CONTAS,
      { nubank: "2026-08-31", itau: "2026-08-28", btg: "2026-08-30" },
      "2026-09-02",
    );
    expect(fronteira).toBe("2026-08-28");
  });

  it("ignora conta que nunca teve lancamento", () => {
    // Uma poupanca parada arrastaria a fita inteira para cinza.
    const fronteira = fronteiraDeDados(
      CONTAS,
      { nubank: "2026-08-31", itau: "2026-08-30" },
      "2026-09-02",
    );
    expect(fronteira).toBe("2026-08-30");
  });

  it("nunca passa de hoje", () => {
    // Rede contra parcela futura: nenhum dia adiante pode ser dado como
    // recebido.
    expect(
      fronteiraDeDados(CONTAS, { nubank: "2027-03-10", itau: "2027-03-10" }, "2026-09-02"),
    ).toBe("2026-09-02");
  });

  it("sem conta com lancamento nenhum, nao ha fronteira", () => {
    expect(fronteiraDeDados(CONTAS, {}, "2026-09-02")).toBeNull();
    expect(fronteiraDeDados([], { nubank: "2026-08-31" }, "2026-09-02")).toBeNull();
  });
});

describe("situacaoDoDia", () => {
  const fronteira = "2026-08-30";

  it("dia com despesa sem categoria fica pendente", () => {
    expect(situacaoDoDia("2026-08-29", fronteira, { "2026-08-29": 3 })).toBe("pendente");
  });

  it("dia recebido e sem pendencia fica pronto", () => {
    expect(situacaoDoDia("2026-08-29", fronteira, {})).toBe("pronto");
    expect(situacaoDoDia("2026-08-29", fronteira, { "2026-08-29": 0 })).toBe("pronto");
  });

  it("dia depois da fronteira e sem dados, mesmo tendo algum lancamento", () => {
    // O parcial do Nubank chegou, o do Itau nao: o dia nao esta pronto nem
    // pendente, esta incompleto.
    expect(situacaoDoDia("2026-08-31", fronteira, { "2026-08-31": 1 })).toBe("sem-dados");
    expect(situacaoDoDia("2026-09-01", fronteira, {})).toBe("sem-dados");
  });

  it("o proprio dia da fronteira ja conta como recebido", () => {
    expect(situacaoDoDia(fronteira, fronteira, {})).toBe("pronto");
  });

  it("sem fronteira, todo dia e sem dados", () => {
    expect(situacaoDoDia("2026-08-29", null, { "2026-08-29": 3 })).toBe("sem-dados");
  });
});
