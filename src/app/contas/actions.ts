"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { apagarRegraDeCartao, salvarRegraDeCartao } from "@/lib/db/repository";

/**
 * A regra fixa de um cartao.
 *
 * Mexe no que TODA despesa daquele plastico vira, entao a gravacao revalida as
 * telas que somam despesa — deixar o painel com o total velho depois de mudar
 * a regra seria mostrar dois numeros diferentes para a mesma pergunta.
 */

function revalidar() {
  for (const rota of ["/contas", "/", "/dia", "/categorias", "/contrapartes"]) {
    revalidatePath(rota);
  }
}

function opcional(valor: FormDataEntryValue | null): string | null {
  const bruto = String(valor ?? "").trim();
  return bruto || null;
}

export async function salvarCartao(formData: FormData): Promise<void> {
  await requireSession();

  const accountId = String(formData.get("accountId") ?? "");
  const cardNumber = String(formData.get("cardNumber") ?? "");
  if (!accountId || !cardNumber.trim()) return;

  const centro = opcional(formData.get("costCenterId"));
  const categoria = opcional(formData.get("categoryId"));

  await salvarRegraDeCartao(fromPostgres(getSql()), {
    accountId,
    cardNumber,
    categoryId: categoria,
    // O centro so vale dentro de uma categoria: sem ela, guardar o centro
    // deixaria uma regra que classifica pela metade.
    costCenterId: categoria ? centro : null,
    label: opcional(formData.get("label")),
  });

  revalidar();
}

export async function removerCartao(formData: FormData): Promise<void> {
  await requireSession();

  const accountId = String(formData.get("accountId") ?? "");
  const cardNumber = String(formData.get("cardNumber") ?? "");
  if (!accountId || !cardNumber.trim()) return;

  await apagarRegraDeCartao(fromPostgres(getSql()), accountId, cardNumber);
  revalidar();
}
