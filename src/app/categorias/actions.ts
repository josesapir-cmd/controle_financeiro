"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCategoria,
  arquivarCategoria,
  arquivarCentroDeCusto,
  criarCentroDeCusto,
  salvarCategoria,
  salvarCentroDeCusto,
  type TipoDeCategoria,
} from "@/lib/db/repository";

/**
 * Cadastro de categorias e centros de custo.
 *
 * Renomear aqui vale para todo o historico de uma vez: a contraparte aponta
 * para o registro, nao guarda uma copia do nome. Era o que o texto livre nao
 * dava — trocar "Viagem" por "Viagens" exigiria reescrever cada linha.
 */

function revalidar() {
  for (const rota of ["/categorias", "/contrapartes", "/"]) revalidatePath(rota);
}

function tipo(valor: FormDataEntryValue | null): TipoDeCategoria {
  const bruto = String(valor ?? "despesa");
  return bruto === "receita" || bruto === "movimentacao" ? bruto : "despesa";
}

/** Valor em reais digitado em pt-BR: aceita virgula e devolve null se vazio. */
function dinheiro(valor: FormDataEntryValue | null): number | null {
  const bruto = String(valor ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!bruto) return null;
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

export async function criarCategoria(formData: FormData): Promise<void> {
  await requireSession();

  const nome = String(formData.get("name") ?? "");
  if (!nome.trim()) return;

  await acharOuCriarCategoria(fromPostgres(getSql()), nome, tipo(formData.get("kind")));
  revalidar();
}

export async function editarCategoria(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await salvarCategoria(fromPostgres(getSql()), id, {
    name: String(formData.get("name") ?? ""),
    kind: tipo(formData.get("kind")),
  });
  revalidar();
}

export async function alternarCategoria(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  // Arquivar, nunca apagar: apagar levaria junto a classificacao das
  // contrapartes ligadas a ela, que e trabalho feito a mao.
  await arquivarCategoria(
    fromPostgres(getSql()),
    id,
    String(formData.get("arquivada") ?? "") !== "sim",
  );
  revalidar();
}

export async function adicionarCentro(formData: FormData): Promise<void> {
  await requireSession();

  const categoriaId = String(formData.get("categoryId") ?? "");
  const nome = String(formData.get("name") ?? "");
  if (!categoriaId || !nome.trim()) return;

  await criarCentroDeCusto(fromPostgres(getSql()), categoriaId, nome);
  revalidar();
}

export async function editarCentro(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await salvarCentroDeCusto(fromPostgres(getSql()), id, {
    name: String(formData.get("name") ?? ""),
    note: String(formData.get("note") ?? ""),
    startsOn: String(formData.get("startsOn") ?? "") || null,
    endsOn: String(formData.get("endsOn") ?? "") || null,
    budget: dinheiro(formData.get("budget")),
  });
  revalidar();
}

export async function alternarCentro(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await arquivarCentroDeCusto(
    fromPostgres(getSql()),
    id,
    String(formData.get("arquivado") ?? "") !== "sim",
  );
  revalidar();
}
