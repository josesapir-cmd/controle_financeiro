import { describe, expect, it } from "vitest";
import {
  dataCompleta,
  diaCurto,
  localDay,
  localMonth,
  localTime,
  minutesOfDay,
  monthRange,
  noonAt,
  shiftDay,
  shiftMonth,
} from "../dates";

describe("localDay", () => {
  // Brasilia e UTC-3: 01h UTC ainda e o dia anterior por la.
  it("recua a madrugada UTC para o dia local anterior", () => {
    expect(localDay("2026-08-27T01:00:00.000Z")).toBe("2026-08-26");
  });

  it("mantem o dia quando o horario nao cruza a fronteira", () => {
    expect(localDay("2026-08-26T18:19:21.000Z")).toBe("2026-08-26");
  });

  it("devolve vazio para data invalida", () => {
    expect(localDay("nao-e-data")).toBe("");
  });
});

describe("localMonth", () => {
  it("atribui a virada do mes ao mes local", () => {
    expect(localMonth("2026-09-01T01:00:00.000Z")).toBe("2026-08");
  });
});

describe("localTime", () => {
  it("converte de UTC para o horario de Brasilia", () => {
    expect(localTime("2026-08-26T18:19:21.000Z")).toBe("15:19");
  });

  it("lida com a virada da meia-noite", () => {
    expect(localTime("2026-08-27T01:30:00.000Z")).toBe("22:30");
  });
});

describe("minutesOfDay", () => {
  it("conta minutos desde a meia-noite local", () => {
    expect(minutesOfDay("2026-08-26T18:19:21.000Z")).toBe(15 * 60 + 19);
  });
});

describe("shiftDay", () => {
  it("anda para tras e para frente", () => {
    expect(shiftDay("2026-08-27", -1)).toBe("2026-08-26");
    expect(shiftDay("2026-08-27", 1)).toBe("2026-08-28");
  });

  it("atravessa a virada do mes", () => {
    expect(shiftDay("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("atravessa a virada do ano", () => {
    expect(shiftDay("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("noonAt", () => {
  it("cai no mesmo dia local que foi pedido", () => {
    expect(localDay(noonAt("2026-05-12"))).toBe("2026-05-12");
  });

  // O horario e inventado por falta de dado; o que nao pode variar e o dia.
  it("fica longe das duas viradas do dia", () => {
    const hora = Number(localTime(noonAt("2026-05-12")).slice(0, 2));

    expect(hora).toBeGreaterThanOrEqual(6);
    expect(hora).toBeLessThanOrEqual(18);
  });

  it("devolve data invalida para entrada invalida, sem lancar", () => {
    expect(Number.isNaN(noonAt("nao e data").getTime())).toBe(true);
  });
});

describe("shiftMonth", () => {
  it("anda para tras e para frente", () => {
    expect(shiftMonth("2026-09", -1)).toBe("2026-08");
    expect(shiftMonth("2026-09", 1)).toBe("2026-10");
  });

  it("vira o ano nas duas direcoes", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
  });

  it("anda varios meses de uma vez", () => {
    expect(shiftMonth("2026-09", -12)).toBe("2025-09");
    expect(shiftMonth("2026-09", -20)).toBe("2025-01");
  });

  it("nao cai no mes errado partindo de mes curto", () => {
    // Somar meses a partir do dia 31 estoura para o mes seguinte em fevereiro;
    // por isso a conta parte do meio do mes.
    expect(shiftMonth("2026-01", 1)).toBe("2026-02");
    expect(shiftMonth("2026-03", -1)).toBe("2026-02");
  });

  it("devolve a entrada quando ela nao e um mes", () => {
    expect(shiftMonth("", 1)).toBe("");
    expect(shiftMonth("nada", 1)).toBe("nada");
  });
});

describe("monthRange", () => {
  const hoje = new Date("2026-09-10T15:00:00Z");

  it("mes fechado vai do dia 1 ao ultimo dia", () => {
    expect(monthRange("2026-08", hoje)).toEqual({ from: "2026-08-01", to: "2026-08-31" });
    expect(monthRange("2026-04", hoje)).toEqual({ from: "2026-04-01", to: "2026-04-30" });
  });

  it("acerta fevereiro, inclusive bissexto", () => {
    expect(monthRange("2026-02", hoje).to).toBe("2026-02-28");
    expect(monthRange("2024-02", hoje).to).toBe("2024-02-29");
  });

  it("o mes corrente para em hoje", () => {
    // Prometer ate o dia 30 num mes que esta no dia 10 nao traz nada a mais.
    expect(monthRange("2026-09", hoje)).toEqual({ from: "2026-09-01", to: "2026-09-10" });
  });
});

describe("diaCurto", () => {
  it("escreve dia e mes sem o 'de' nem o ponto do Intl", () => {
    expect(diaCurto("2026-08-13")).toBe("13/ago");
  });

  it("preenche o dia com zero para os rotulos ficarem do mesmo tamanho", () => {
    expect(diaCurto("2026-01-05")).toBe("05/jan");
  });

  it("le a data como UTC, entao nao escorrega para o dia anterior", () => {
    expect(diaCurto("2026-03-01")).toBe("01/mar");
    expect(diaCurto("2026-12-31")).toBe("31/dez");
  });
});

describe("dataCompleta", () => {
  it("escreve na ordem de quem le em portugues", () => {
    expect(dataCompleta("2025-05-08")).toBe("08/05/2025");
  });

  it("mantem o ano, que e o que diferencia duas chamadas do mesmo mes", () => {
    expect(dataCompleta("2025-06-30")).not.toBe(dataCompleta("2026-06-30"));
  });

  it("devolve o que recebeu quando nao e uma data", () => {
    expect(dataCompleta("")).toBe("");
    expect(dataCompleta("hoje")).toBe("hoje");
  });
});
