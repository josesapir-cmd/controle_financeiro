import { describe, expect, it } from "vitest";
import { localDay, localMonth, localTime, minutesOfDay, shiftDay } from "../dates";

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
