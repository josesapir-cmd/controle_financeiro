"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  encerrarImportacao,
  lerImportacao,
  salvarProdutosDoPedido,
} from "@/lib/db/repository";
import { gravarLinhas } from "@/lib/importacao/gravar";
import { doFormulario, type Linha } from "@/lib/importacao/linhas";

/**
 * Conferencia de um lote lido de prints.
 *
 * A gravacao acontece a partir do que esta no formulario, nao do que o modelo
 * leu: o usuario pode corrigir data, descricao e valor antes de confirmar, e e
 * a correcao dele que vira lancamento. Por isso as linhas passam de novo por
 * `normalizar` — a identidade do lancamento depende desses campos.
 */

function revalidar() {
  for (const rota of ["/", "/dia", "/contrapartes", "/conexoes"]) revalidatePath(rota);
}

export async function confirmarImportacao(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) redirect("/conexoes");

  const db = fromPostgres(getSql());
  const lote = await lerImportacao(db, id);
  if (!lote || lote.status !== "pendente") redirect("/conexoes");

  const indices = String(formData.get("indices") ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter(Boolean);

  const escolhidas: Linha[] = [];
  for (const indice of indices) {
    if (!formData.get(`incluir_${indice}`)) continue;

    const linha = doFormulario({
      dia: String(formData.get(`data_${indice}`) ?? ""),
      descricao: String(formData.get(`descricao_${indice}`) ?? ""),
      // O campo de valor aceita virgula porque e assim que se digita em pt-BR.
      valor: Number(String(formData.get(`valor_${indice}`) ?? "").replace(",", ".")),
      tipo: String(formData.get(`tipo_${indice}`) ?? "despesa"),
      confianca: String(formData.get(`confianca_${indice}`) ?? "baixa"),
      // A ocorrencia vem do formulario, nao e recontada aqui: ela foi fixada
      // quando a linha foi lida e faz parte da identidade do lancamento.
      // Reconta-la mudaria o id de uma linha so porque a irma foi desmarcada.
      ocorrencia: Number(formData.get(`ocorrencia_${indice}`) ?? 1),
    });

    if (linha) escolhidas.push(linha);
  }

  const linhas = escolhidas;
  await gravarLinhas(db, linhas);

  // Produto de tela de pedido nao vira lancamento: a compra ja chegou pelo
  // cartao. So se gruda na cobranca que ja existe, com o nome que a fatura nao
  // traz. Contar de novo aqui seria contar o mesmo dinheiro duas vezes.
  const produtos = String(formData.get("produtos") ?? "")
    .split(",")
    .map((valor) => valor.trim())
    .filter(Boolean)
    .map((chave) => ({
      chave,
      transactionId: String(formData.get(`produto_${chave}`) ?? ""),
    }))
    .filter((item) => item.transactionId)
    .map(({ chave, transactionId }) => ({
      transactionId,
      store: String(formData.get(`produto_loja_${chave}`) ?? ""),
      name: String(formData.get(`produto_nome_${chave}`) ?? ""),
      reference: String(formData.get(`produto_ref_${chave}`) ?? "") || null,
      orderedOn: String(formData.get(`produto_dia_${chave}`) ?? "") || null,
      amount: Number(formData.get(`produto_valor_${chave}`) ?? 0) || null,
    }));

  const gravados = await salvarProdutosDoPedido(db, produtos);
  await encerrarImportacao(db, id, "confirmado");

  revalidar();
  redirect(`/conexoes?importado=${linhas.length}&produtos=${gravados}`);
}

export async function descartarImportacao(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (id) await encerrarImportacao(fromPostgres(getSql()), id, "descartado");

  revalidar();
  redirect("/conexoes");
}
