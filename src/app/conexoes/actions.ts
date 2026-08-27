"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { parseItemId } from "@/lib/item-id";

export interface FormState {
  erro?: string;
  sucesso?: string;
}

function revalidar() {
  for (const rota of ["/conexoes", "/", "/dia", "/contrapartes"]) revalidatePath(rota);
}

export async function adicionarConexao(
  _anterior: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSession();

  const entrada = String(formData.get("itemId") ?? "");
  if (!entrada.trim()) return { erro: "Cole a URL da conexao ou o itemId." };

  const itemId = parseItemId(entrada);
  if (!itemId) {
    return {
      erro: "Nao encontrei um itemId no que voce colou. Cole a URL da conexao no Meu Pluggy.",
    };
  }

  try {
    const db = fromPostgres(getSql());
    await db.query(
      `INSERT INTO connections (item_id, connector_name)
       VALUES ($1, $2) ON CONFLICT (item_id) DO NOTHING`,
      [itemId, "(aguardando sincronizacao)"],
    );
    revalidar();
    return { sucesso: "Conexao adicionada. Os dados aparecem na proxima sincronizacao." };
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Nao foi possivel adicionar." };
  }
}

/**
 * Remove a conexao, preservando contas e transacoes.
 *
 * O historico nao pode depender da conexao continuar existindo — e a razao de o
 * app ter passado a guardar dados. A chave estrangeira usa ON DELETE SET NULL
 * justamente para isso.
 */
export async function removerConexao(formData: FormData): Promise<void> {
  await requireSession();

  const itemId = String(formData.get("itemId") ?? "");
  if (!itemId) return;

  const db = fromPostgres(getSql());
  await db.query("DELETE FROM connections WHERE item_id = $1", [itemId]);
  revalidar();
}
