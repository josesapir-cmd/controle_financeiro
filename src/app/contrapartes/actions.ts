"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  clearCounterpartyLink,
  setCounterpartyLink,
  setLabel,
} from "@/lib/db/repository";

export async function salvarContraparte(formData: FormData): Promise<void> {
  await requireSession();

  // A chave que a tela conhece ja e o fingerprint gravado nas transacoes.
  const fingerprint = String(formData.get("key") ?? "");
  if (!fingerprint) return;

  await setLabel(fromPostgres(getSql()), fingerprint, {
    category: String(formData.get("category") ?? ""),
    subcategory: String(formData.get("subcategory") ?? ""),
    alias: String(formData.get("alias") ?? ""),
    officialName: String(formData.get("officialName") ?? ""),
  });

  revalidatePath("/contrapartes");
}

/**
 * Decisoes de identidade entre contrapartes.
 *
 * Um nome recortado de print e o nome inteiro do Open Finance sao a mesma
 * contraparte; o app sugere a uniao e o usuario confirma. A recusa tambem e
 * gravada — sem ela, a mesma sugestao voltaria para sempre.
 */
export async function unirContrapartes(formData: FormData): Promise<void> {
  await requireSession();

  const de = String(formData.get("de") ?? "");
  const para = String(formData.get("para") ?? "");
  if (!de || !para) return;

  await setCounterpartyLink(fromPostgres(getSql()), de, para);
  revalidatePath("/contrapartes");
}

export async function separarContrapartes(formData: FormData): Promise<void> {
  await requireSession();

  const de = String(formData.get("de") ?? "");
  if (!de) return;

  // Destino nulo e a decisao "sao diferentes mesmo". Tambem e o que desfaz uma
  // uniao aplicada automaticamente, que nao tem registro proprio para apagar.
  await setCounterpartyLink(fromPostgres(getSql()), de, null);
  revalidatePath("/contrapartes");
}

/** Volta a contraparte ao palpite automatico, esquecendo a decisao registrada. */
export async function reverDecisao(formData: FormData): Promise<void> {
  await requireSession();

  const de = String(formData.get("de") ?? "");
  if (!de) return;

  await clearCounterpartyLink(fromPostgres(getSql()), de);
  revalidatePath("/contrapartes");
}
