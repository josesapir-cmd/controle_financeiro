import { describe, expect, it } from "vitest";
import { localDay, localMonth, localTime, minutesOfDay, noonAt, shiftDay } from "../dates";

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
