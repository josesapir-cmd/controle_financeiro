"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCategoria,
  acharOuCriarCentroDeCusto,
  clearCounterpartyLink,
  setCounterpartyLink,
  setLabel,
  vincularCentroDeCusto,
} from "@/lib/db/repository";

export async function salvarContraparte(formData: FormData): Promise<void> {
  await requireSession();

  // A chave que a tela conhece ja e o fingerprint gravado nas transacoes.
  const fingerprint = String(formData.get("key") ?? "");
  if (!fingerprint) return;

  const categoria = String(formData.get("category") ?? "");
  const subcategoria = String(formData.get("subcategory") ?? "");

  const db = fromPostgres(getSql());
  await setLabel(db, fingerprint, {
    category: categoria,
    subcategory: subcategoria,
    alias: String(formData.get("alias") ?? ""),
    officialName: String(formData.get("officialName") ?? ""),
  });

  // O texto digitado vira taxonomia. Digitar continua sendo a forma de
  // classificar — e mais rapido que caçar numa lista longa —, mas o nome passa
  // a existir como registro, entao a aba de categorias enxerga o que foi criado
  // aqui e renomear la vale para todo o historico de uma vez.
  const categoriaId = await acharOuCriarCategoria(db, categoria);
  const centroId =
    categoriaId && subcategoria.trim()
      ? await acharOuCriarCentroDeCusto(db, categoriaId, subcategoria)
      : null;

  await vincularCentroDeCusto(db, fingerprint, centroId);

  revalidatePath("/contrapartes");
  revalidatePath("/categorias");
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
