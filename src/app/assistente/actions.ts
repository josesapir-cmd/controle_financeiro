"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAcessoDaAssistente } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  acharOuCriarCentroDeCusto,
  apagarAnexo,
  definirApelido,
  encerrarImportacao,
  lancamentoDoSaldoCompartilhado,
  lerAnexo,
  lerImportacao,
  listCategorias,
  setTransactionLabel,
} from "@/lib/db/repository";
import { linhasMarcadas } from "@/lib/importacao/formulario";
import { gravarLinhas } from "@/lib/importacao/gravar";

/**
 * O que a assistente pode fazer, e so isso.
 *
 * Cada acao abre com `requireAcessoDaAssistente` e, quando recebe um id de
 * lancamento, confere que ele e do saldo compartilhado antes de escrever. O
 * id vem do formulario: sem essa conferencia, um formulario editado no
 * navegador classificaria qualquer lancamento do app.
 */

/** Telas do dono que mostram o que a assistente muda. */
function revalidar() {
  for (const rota of ["/assistente", "/", "/dia", "/contrapartes", "/categorias", "/importar"]) {
    revalidatePath(rota);
  }
}

export async function confirmarLote(formData: FormData): Promise<void> {
  await requireAcessoDaAssistente();

  const id = String(formData.get("id") ?? "");
  const db = fromPostgres(getSql());
  const lote = id ? await lerImportacao(db, id) : null;
  if (!lote || lote.status !== "pendente") redirect("/assistente");

  const linhas = linhasMarcadas(formData);
  await gravarLinhas(db, linhas);

  // Telas de pedido lidas no mesmo lote ficam de fora: casa-las exige olhar as
  // cobrancas dos cartoes do dono, que esta tela nao mostra. O lote e
  // encerrado mesmo assim — a tela avisou antes de confirmar.
  await encerrarImportacao(db, id, "confirmado");

  revalidar();
  redirect(`/assistente?lancadas=${linhas.length}`);
}

export async function descartarLote(formData: FormData): Promise<void> {
  await requireAcessoDaAssistente();

  const id = String(formData.get("id") ?? "");
  if (id) await encerrarImportacao(fromPostgres(getSql()), id, "descartado");

  revalidar();
  redirect("/assistente");
}

/**
 * Categoria, subcategoria, comentario e nome da contraparte de um lancamento.
 *
 * Categoria, subcategoria e comentario valem para ESTE lancamento. O nome da
 * contraparte vale para todos os lancamentos dela, em todas as telas: e um
 * apelido, e apelido e da contraparte. Por isso so e gravado quando muda —
 * salvar o comentario de uma linha nao reescreve o apelido que o dono deu.
 */
export async function salvarLancamento(formData: FormData): Promise<void> {
  await requireAcessoDaAssistente();

  const transactionId = String(formData.get("transactionId") ?? "");
  const db = fromPostgres(getSql());
  const lancamento = await lancamentoDoSaldoCompartilhado(db, transactionId);
  if (!lancamento) return;

  // Categoria so das que existem: a assistente escolhe, nao cria. Um id
  // inventado no formulario vira "sem categoria", e nao uma categoria nova.
  const pedida = String(formData.get("categoryId") ?? "");
  const categorias = await listCategorias(db);
  const categoria = categorias.find((c) => c.id === pedida) ?? null;

  // Subcategoria e digitada: achar ou criar dentro da categoria escolhida,
  // como na tela do dia. Sem categoria nao ha onde pendura-la.
  const subcategoria = String(formData.get("subcategoria") ?? "").trim();
  const centroId =
    categoria && subcategoria
      ? await acharOuCriarCentroDeCusto(db, categoria.id, subcategoria.slice(0, 80))
      : null;

  await setTransactionLabel(db, transactionId, {
    categoryId: categoria?.id ?? null,
    costCenterId: centroId,
    note: String(formData.get("note") ?? "").slice(0, 2000),
  });

  const apelido = String(formData.get("apelido") ?? "").trim().slice(0, 120);
  const apelidoAtual = String(formData.get("apelidoAtual") ?? "").trim();
  if (lancamento.counterpartyFingerprint && apelido !== apelidoAtual) {
    await definirApelido(db, lancamento.counterpartyFingerprint, apelido);
  }

  revalidar();
}

/**
 * Tira um anexo. A assistente so tira o que ela mesma anexou: o comprovante
 * que o dono guardou nao some por engano de outra pessoa.
 */
export async function removerAnexo(formData: FormData): Promise<void> {
  const papel = await requireAcessoDaAssistente();

  const id = String(formData.get("anexoId") ?? "");
  const db = fromPostgres(getSql());
  const anexo = await lerAnexo(db, id);
  if (!anexo) return;
  if (!(await lancamentoDoSaldoCompartilhado(db, anexo.transactionId))) return;
  if (papel !== "dono" && anexo.criadoPor !== papel) return;

  await apagarAnexo(db, id);
  revalidar();
}
