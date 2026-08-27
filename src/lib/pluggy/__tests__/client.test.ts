import { describe, expect, it } from "vitest";
import { withinPeriod } from "../client";
import type { Transaction } from "../types";

function tx(date: string): Transaction {
  return {
    id: "t",
    accountId: "a",
    description: "d",
    amount: -10,
    currencyCode: "BRL",
    date,
  };
}

const periodo = { from: "2026-08-01", to: "2026-08-26" };

describe("withinPeriod", () => {
  it("aceita transacao dentro da janela", () => {
    expect(withinPeriod(tx("2026-08-15T12:00:00.000Z"), periodo)).toBe(true);
  });

  it("inclui os dois extremos", () => {
    expect(withinPeriod(tx("2026-08-01T15:00:00.000Z"), periodo)).toBe(true);
    expect(withinPeriod(tx("2026-08-26T20:00:00.000Z"), periodo)).toBe(true);
  });

  it("descarta o que veio antes do inicio", () => {
    expect(withinPeriod(tx("2026-07-31T12:00:00.000Z"), periodo)).toBe(false);
  });

  it("descarta o que veio depois do fim", () => {
    expect(withinPeriod(tx("2026-08-27T15:00:00.000Z"), periodo)).toBe(false);
  });

  // A Pluggy devolve UTC; Brasilia e UTC-3. Uma compra as 22h do dia 26 chega
  // como 27 em UTC, e antes dessa correcao caia fora da janela.
  it("conta transacao noturna no dia local, nao no dia UTC", () => {
    expect(withinPeriod(tx("2026-08-27T01:00:00.000Z"), periodo)).toBe(true);
  });

  it("nao antecipa transacao da madrugada UTC para o dia anterior local", () => {
    expect(withinPeriod(tx("2026-08-01T02:00:00.000Z"), periodo)).toBe(false);
  });

  it("sem janela definida, aceita tudo", () => {
    expect(withinPeriod(tx("2020-01-01T00:00:00.000Z"), {})).toBe(true);
  });
});
