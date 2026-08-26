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
    expect(withinPeriod(tx("2026-08-01T00:00:00.000Z"), periodo)).toBe(true);
    expect(withinPeriod(tx("2026-08-26T23:59:59.000Z"), periodo)).toBe(true);
  });

  it("descarta o que veio antes do inicio", () => {
    expect(withinPeriod(tx("2026-07-31T23:00:00.000Z"), periodo)).toBe(false);
  });

  it("descarta o que veio depois do fim", () => {
    expect(withinPeriod(tx("2026-08-27T01:00:00.000Z"), periodo)).toBe(false);
  });

  it("sem janela definida, aceita tudo", () => {
    expect(withinPeriod(tx("2020-01-01T00:00:00.000Z"), {})).toBe(true);
  });
});
