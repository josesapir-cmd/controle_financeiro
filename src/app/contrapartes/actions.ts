"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCategoria,
  acharOuCriarCentroDeCusto,
  clearCounterpartyLink,
  definirApelido,
  setCounterpartyLink,
  setLabel,
  vincularCentroDeCusto,
} from "@/lib/db/repository";
import type { SugestaoDeContraparte } from "@/lib/finance/busca-de-contraparte";
import {
  esquecerIndiceDeContrapartes,
  loadSugestoesDeContrapartes,
} from "@/lib/finance/service";

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

  esquecerIndiceDeContrapartes();
  revalidatePath("/contrapartes");
  revalidatePath("/categorias");
}

/**
 * Grava so o apelido da contraparte.
 *
 * A busca conhece a contraparte pelo nome que o banco mandou, e o apelido e
 * como o usuario a chama — ele aparece no lugar do nome nas outras telas. Acao
 * separada da classificacao de proposito: o formulario da busca nao tem campo
 * de categoria, e reaproveitar `salvarContraparte` mandaria categoria vazia e
 * apagaria a classificacao existente.
 */
export async function salvarApelido(formData: FormData): Promise<void> {
  await requireSession();

  const fingerprint = String(formData.get("key") ?? "");
  if (!fingerprint) return;

  await definirApelido(
    fromPostgres(getSql()),
    fingerprint,
    String(formData.get("alias") ?? ""),
  );

  esquecerIndiceDeContrapartes();
  // O apelido substitui o nome em toda tela que mostra contraparte, entao
  // nenhuma delas pode continuar servindo a versao anterior do cache.
  revalidatePath("/", "layout");
}

/** Sugestoes do autocomplete da busca. Chamada a cada tecla, ja com debounce. */
export async function sugerirContrapartes(termo: string): Promise<SugestaoDeContraparte[]> {
  await requireSession();
  return loadSugestoesDeContrapartes(String(termo ?? "").slice(0, 120));
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
