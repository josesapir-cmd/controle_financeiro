import type { Db } from "@/lib/db/adapter";
import {
  ensureSharedBalanceAccount,
  upsertTransactions,
  type TransactionInput,
} from "@/lib/db/repository";
import { normalizeName } from "@/lib/finance/counterparties";
import { noonAt } from "@/lib/finance/dates";
import { type Linha } from "./linhas";

/**
 * Gravacao das despesas do saldo compartilhado conferidas pelo usuario.
 *
 * Escolhas que valem registro:
 *
 * - a contraparte e a propria descricao, com a MESMA normalizacao que o Open
 *   Finance usa para contraparte sem documento (`normalizeName`). Assim esses
 *   gastos caem na aba de contrapartes junto com todos os outros, e um nome que
 *   chegue identico pelas duas vias vira uma contraparte so, sem depender de
 *   conciliacao. Nome recortado pelo print, que nao casa exato, e tratado por
 *   `finance/conciliacao.ts`.
 * - o horario e meio-dia local. O print nao mostra hora; inventar uma exata
 *   seria pior. A etiqueta de origem fica visivel no detalhe do lancamento para
 *   que ninguem leia esse horario como medido.
 * - `origin = 'manual'` separa isso do que veio do Open Finance, para poder ser
 *   reconferido ou removido sem tocar no historico sincronizado.
 */

export const CATEGORIA = "Saldo compartilhado";

export function paraLancamento(linha: Linha, accountId: string): TransactionInput {
  return {
    id: linha.id,
    accountId,
    postedAt: noonAt(linha.dia),
    localDay: linha.dia,
    amount: linha.valor,
    currency: "BRL",
    category: CATEGORIA,
    description: linha.descricao,
    counterpartyKey: normalizeName(linha.descricao),
    counterpartyName: linha.descricao,
    counterpartySelf: false,
    details: [
      { label: "Origem", value: "Print do saldo compartilhado (Nubank)" },
      { label: "Horario", value: "nao informado no print" },
      { label: "Leitura", value: `confianca ${linha.confianca}` },
    ],
    origin: "manual",
  };
}

/** Grava as linhas na conta virtual e devolve quantas foram escritas. */
export async function gravarLinhas(db: Db, linhas: Linha[]): Promise<number> {
  if (linhas.length === 0) return 0;
  const accountId = await ensureSharedBalanceAccount(db);
  return upsertTransactions(
    db,
    linhas.map((linha) => paraLancamento(linha, accountId)),
  );
}
