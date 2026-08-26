import { describe, expect, it } from "vitest";
import type { Account, Transaction } from "@/lib/pluggy/types";
import { formatBRL, maskAccountNumber, netWorth } from "../money";
import { currentMonthRange, monthlyFlow, totalsByCategory } from "../summary";

function tx(amount: number, extra: Partial<Transaction> = {}): Transaction {
  return {
    id: Math.random().toString(36).slice(2),
    accountId: "acc-1",
    description: "teste",
    amount,
    currencyCode: "BRL",
    date: "2026-08-10T00:00:00.000Z",
    ...extra,
  };
}

function account(type: Account["type"], balance: number): Account {
  return {
    id: Math.random().toString(36).slice(2),
    itemId: "item-1",
    type,
    name: "conta",
    balance,
    currencyCode: "BRL",
  };
}

describe("netWorth", () => {
  it("subtrai a fatura do cartao em vez de soma-la", () => {
    const accounts = [account("BANK", 3153.01), account("CREDIT", 1200)];
    expect(netWorth(accounts)).toBeCloseTo(1953.01, 2);
  });

  it("devolve zero sem contas", () => {
    expect(netWorth([])).toBe(0);
  });

  it("preserva saldo negativo em conta corrente", () => {
    expect(netWorth([account("BANK", -50)])).toBe(-50);
  });
});

describe("totalsByCategory", () => {
  it("agrupa apenas saidas e ordena pelo maior gasto", () => {
    const result = totalsByCategory([
      tx(-100, { category: "Mercado" }),
      tx(-50, { category: "Transporte" }),
      tx(-30, { category: "Mercado" }),
      tx(5000, { category: "Salario" }),
    ]);

    expect(result.map((r) => r.category)).toEqual(["Mercado", "Transporte"]);
    expect(result[0].total).toBe(130);
    expect(result[0].count).toBe(2);
  });

  it("soma as fracoes para 1 quando ha gastos", () => {
    const result = totalsByCategory([
      tx(-100, { category: "Mercado" }),
      tx(-300, { category: "Aluguel" }),
    ]);
    const soma = result.reduce((total, r) => total + r.share, 0);
    expect(soma).toBeCloseTo(1, 10);
  });

  it("agrupa transacoes sem categoria sob um rotulo unico", () => {
    const result = totalsByCategory([tx(-10), tx(-20, { category: "  " })]);
    expect(result).toHaveLength(1);
    expect(result[0].category).toBe("Sem categoria");
    expect(result[0].total).toBe(30);
  });

  it("devolve lista vazia quando so ha entradas", () => {
    expect(totalsByCategory([tx(1000, { category: "Salario" })])).toEqual([]);
  });
});

describe("monthlyFlow", () => {
  it("separa entradas de saidas por mes, em ordem cronologica", () => {
    const result = monthlyFlow([
      tx(-100, { date: "2026-08-05" }),
      tx(3000, { date: "2026-08-01" }),
      tx(-200, { date: "2026-07-20" }),
    ]);

    expect(result.map((r) => r.month)).toEqual(["2026-07", "2026-08"]);
    expect(result[1]).toMatchObject({ income: 3000, expenses: 100, net: 2900 });
  });

  it("ignora datas fora do formato esperado", () => {
    expect(monthlyFlow([tx(-100, { date: "sem-data" })])).toEqual([]);
  });
});

describe("formatBRL", () => {
  it("nao exibe menos zero", () => {
    expect(formatBRL(-0)).not.toContain("-");
  });
});

describe("maskAccountNumber", () => {
  it("revela apenas os ultimos quatro digitos", () => {
    expect(maskAccountNumber("01212573-3")).toBe("•••• 5733");
  });

  it("lida com valor ausente", () => {
    expect(maskAccountNumber(null)).toBe("");
  });
});

describe("currentMonthRange", () => {
  it("vai do primeiro dia do mes ate hoje", () => {
    expect(currentMonthRange(new Date("2026-08-26T12:00:00Z"))).toEqual({
      from: "2026-08-01",
      to: "2026-08-26",
    });
  });
});
