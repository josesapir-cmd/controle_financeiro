"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { setLabel } from "@/lib/db/repository";

export async function salvarContraparte(formData: FormData): Promise<void> {
  await requireSession();

  // A chave que a tela conhece ja e o fingerprint gravado nas transacoes.
  const fingerprint = String(formData.get("key") ?? "");
  if (!fingerprint) return;

  await setLabel(fromPostgres(getSql()), fingerprint, {
    category: String(formData.get("category") ?? ""),
    subcategory: String(formData.get("subcategory") ?? ""),
    alias: String(formData.get("alias") ?? ""),
  });

  revalidatePath("/contrapartes");
}
