"use server";

import { revalidatePath } from "next/cache";
import { setCounterparty } from "@/lib/counterparty-store";

export async function salvarContraparte(formData: FormData): Promise<void> {
  const key = String(formData.get("key") ?? "");
  if (!key) return;

  await setCounterparty(key, {
    category: String(formData.get("category") ?? ""),
    subcategory: String(formData.get("subcategory") ?? ""),
    alias: String(formData.get("alias") ?? ""),
  });

  revalidatePath("/contrapartes");
}
