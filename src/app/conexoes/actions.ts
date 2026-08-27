"use server";

import { revalidatePath } from "next/cache";
import { addItemId, removeItemId } from "@/lib/store";

/**
 * Estado devolvido ao formulario. Erro de colagem e o caso comum aqui, entao a
 * tela precisa dizer o que houve em vez de recarregar em silencio.
 */
export interface FormState {
  erro?: string;
  sucesso?: string;
}

function revalidar() {
  revalidatePath("/conexoes");
  revalidatePath("/");
}

export async function adicionarConexao(
  _anterior: FormState,
  formData: FormData,
): Promise<FormState> {
  const entrada = String(formData.get("itemId") ?? "");

  if (!entrada.trim()) {
    return { erro: "Cole a URL da conexao ou o itemId." };
  }

  try {
    await addItemId(entrada);
    revalidar();
    return { sucesso: "Conexao adicionada." };
  } catch (error) {
    return { erro: error instanceof Error ? error.message : "Nao foi possivel adicionar." };
  }
}

export async function removerConexao(formData: FormData): Promise<void> {
  const itemId = String(formData.get("itemId") ?? "");
  if (itemId) {
    await removeItemId(itemId);
    revalidar();
  }
}
