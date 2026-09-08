"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCentroDeCusto,
  lerLancamento,
  listCategorias,
  purchaseFingerprint,
  setLabel,
  setRotuloDeCompra,
  setTransactionLabel,
  setTransactionNote,
  vincularCentroDeCusto,
} from "@/lib/db/repository";
import { chaveDaCompra } from "@/lib/finance/parcelamento";

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

  // Uma compra parcelada e uma decisao so. Gravar tambem na COMPRA faz as
  // outras parcelas herdarem — inclusive as de anos a frente, que a fatura ja
  // mandou e que de outro modo voltariam a pedir classificacao mes a mes.
  const lancamento = await lerLancamento(db, transactionId);
  const daCompra = lancamento
    ? chaveDaCompra(lancamento.details, lancamento.description)
    : null;

  if (daCompra) {
    await setRotuloDeCompra(db, purchaseFingerprint(daCompra), {
      categoryId: categoriaId,
      costCenterId: centroId,
    });
  }

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

  const db = fromPostgres(getSql());

  await setTransactionLabel(db, transactionId, {
    categoryId: null,
    costCenterId: null,
    note: null,
  });

  // Limpar uma parcela tem de limpar a COMPRA: senao a categoria da compra
  // reapareceria no mesmo instante, e o botao pareceria nao funcionar.
  const lancamento = await lerLancamento(db, transactionId);
  const daCompra = lancamento
    ? chaveDaCompra(lancamento.details, lancamento.description)
    : null;

  if (daCompra) {
    await setRotuloDeCompra(db, purchaseFingerprint(daCompra), {
      categoryId: null,
      costCenterId: null,
    });
  }

  for (const rota of ["/dia", "/categorias", "/contrapartes", "/"]) revalidatePath(rota);
}

/**
 * Comentario de um lancamento, sozinho.
 *
 * Separado de `classificarLancamento` porque comentar nao e classificar: no
 * modo jogo o comentario e escrito antes de haver categoria, e passar pelo
 * outro caminho apagaria a classificacao de quem ja tem uma.
 */
export async function comentarLancamento(formData: FormData): Promise<void> {
  await requireSession();

  const transactionId = String(formData.get("transactionId") ?? "");
  if (!transactionId) return;

  await setTransactionNote(
    fromPostgres(getSql()),
    transactionId,
    String(formData.get("note") ?? ""),
  );

  revalidatePath("/dia");
}
