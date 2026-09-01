"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCentroDeCusto,
  listCategorias,
  setLabel,
  setTransactionLabel,
  vincularCentroDeCusto,
} from "@/lib/db/repository";

/**
 * Classificacao de um lancamento pela tela do dia.
 *
 * O padrao e valer para AQUELE lancamento: arrastar um Pix para Viagem nao pode
 * afirmar que toda transferencia para aquela pessoa e viagem. Quem quiser a
 * regra ampla marca "aplicar a todos", e ai o cadastro da contraparte tambem e
 * gravado — que e o que a aba de contrapartes ja fazia.
 */
export async function classificarLancamento(formData: FormData): Promise<void> {
  await requireSession();

  const transactionId = String(formData.get("transactionId") ?? "");
  if (!transactionId) return;

  const db = fromPostgres(getSql());
  const categoriaId = String(formData.get("categoryId") ?? "") || null;
  const comentario = String(formData.get("note") ?? "");

  // Subcategoria nova digitada no editor vira centro de custo na hora: exigir
  // uma visita a outra tela para criar "Bariloche 2026" mataria o fluxo.
  const nova = String(formData.get("novaSubcategoria") ?? "").trim();
  let centroId = String(formData.get("costCenterId") ?? "") || null;

  if (categoriaId && nova) {
    centroId = await acharOuCriarCentroDeCusto(db, categoriaId, nova);
  }

  await setTransactionLabel(db, transactionId, {
    categoryId: categoriaId,
    costCenterId: centroId,
    note: comentario,
  });

  if (String(formData.get("aplicarATodos") ?? "") === "sim") {
    const contraparte = String(formData.get("counterpartyKey") ?? "");
    if (contraparte && categoriaId) {
      const categorias = await listCategorias(db);
      const categoria = categorias.find((c) => c.id === categoriaId);

      if (categoria) {
        await setLabel(db, contraparte, {
          category: categoria.name,
          subcategory: String(formData.get("costCenterName") ?? "") || nova || null,
        });
        await vincularCentroDeCusto(db, contraparte, centroId);
      }
    }
  }

  for (const rota of ["/dia", "/categorias", "/contrapartes", "/"]) revalidatePath(rota);
}

/** Tira a categoria do lancamento; ele volta a herdar a da contraparte. */
export async function limparLancamento(formData: FormData): Promise<void> {
  await requireSession();

  const transactionId = String(formData.get("transactionId") ?? "");
  if (!transactionId) return;

  await setTransactionLabel(fromPostgres(getSql()), transactionId, {
    categoryId: null,
    costCenterId: null,
    note: null,
  });

  for (const rota of ["/dia", "/categorias", "/contrapartes", "/"]) revalidatePath(rota);
}
