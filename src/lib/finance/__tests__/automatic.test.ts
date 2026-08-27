import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/pluggy/types";
import { isBankGenerated, isUserInitiatedExpense } from "../automatic";

function tx(description: string, amount = -50, category?: string): Transaction {
  return {
    id: "t",
    accountId: "a",
    description,
    amount,
    currencyCode: "BRL",
    date: "2026-08-26T15:00:00.000Z",
    category: category ?? "Shopping",
  };
}

describe("isBankGenerated", () => {
  it("reconhece IOF", () => {
    expect(isBankGenerated(tx("IOF sobre compra internacional"))).toBe(true);
  });

  it("reconhece rendimento de saldo remunerado", () => {
    expect(isBankGenerated(tx("Rendimento Saldo Remunerado", 3.21))).toBe(true);
  });

  it("reconhece juros", () => {
    expect(isBankGenerated(tx("Juros do cheque especial"))).toBe(true);
  });

  it("ignora acentos e caixa", () => {
    expect(isBankGenerated(tx("REMUNERAÇÃO DE SALDO", 1.5))).toBe(true);
  });

  it("nao confunde palavra que apenas contem as letras de iof", () => {
    expect(isBankGenerated(tx("Compra na Bioforma"))).toBe(false);
  });

  it("deixa passar despesa comum", () => {
    expect(isBankGenerated(tx("Supermercado Pao de Acucar"))).toBe(false);
  });
});

describe("isUserInitiatedExpense", () => {
  it("aceita compra comum", () => {
    expect(isUserInitiatedExpense(tx("Restaurante"))).toBe(true);
  });

  it("recusa entrada de dinheiro", () => {
    expect(isUserInitiatedExpense(tx("Salario", 8000, "Salary"))).toBe(false);
  });

  it("recusa lancamento automatico do banco", () => {
    expect(isUserInitiatedExpense(tx("IOF"))).toBe(false);
  });

  it("recusa aplicacao em investimento", () => {
    expect(isUserInitiatedExpense(tx("Aplicacao CDB", -45000, "Investments"))).toBe(false);
  });

  it("recusa transferencia entre contas proprias", () => {
    expect(isUserInitiatedExpense(tx("Pix enviado", -2000, "Same person transfer"))).toBe(false);
  });
});
