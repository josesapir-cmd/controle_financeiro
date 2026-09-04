"use server";

import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import {
  apagarChamada,
  criarCompromisso,
  encerrarCompromisso,
  liquidarChamada,
  registrarChamada,
  salvarChamada,
  salvarCompromisso,
} from "@/lib/db/repository";

/**
 * Compromissos de capital: o cadastro do fundo e o registro das chamadas.
 *
 * Toda escrita passa por `requireSession` antes de olhar o formulario. Server
 * Action e um endpoint publico como qualquer outro — o botao estar atras do
 * login nao protege nada.
 */

const DATA_ISO = /^\d{4}-\d{2}-\d{2}$/;

function revalidar() {
  revalidatePath("/");
}

/**
 * Valor em reais digitado em pt-BR.
 *
 * Aceita "500.000,00" e "500000". O ponto some antes da virga virar ponto: na
 * ordem inversa, "500.000" viraria 500.
 */
function dinheiro(valor: FormDataEntryValue | null): number | null {
  const bruto = String(valor ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!bruto) return null;
  const numero = Number(bruto);
  return Number.isFinite(numero) && numero > 0 ? numero : null;
}

function data(valor: FormDataEntryValue | null): string | null {
  const bruto = String(valor ?? "").trim();
  return DATA_ISO.test(bruto) ? bruto : null;
}

function texto(valor: FormDataEntryValue | null): string | null {
  const bruto = String(valor ?? "").trim();
  return bruto || null;
}

export async function adicionarCompromisso(formData: FormData): Promise<void> {
  await requireSession();

  const nome = String(formData.get("name") ?? "").trim();
  const comprometido = dinheiro(formData.get("committed"));
  if (!nome || comprometido === null) return;

  await criarCompromisso(fromPostgres(getSql()), {
    name: nome,
    committed: comprometido,
    signedOn: data(formData.get("signedOn")),
    note: texto(formData.get("note")),
  });

  revalidar();
}

export async function editarCompromisso(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  const comprometido = dinheiro(formData.get("committed"));
  const nome = String(formData.get("name") ?? "").trim();
  if (!id || !nome || comprometido === null) return;

  await salvarCompromisso(fromPostgres(getSql()), id, {
    name: nome,
    committed: comprometido,
    signedOn: data(formData.get("signedOn")),
    note: texto(formData.get("note")),
  });

  revalidar();
}

export async function alternarCompromisso(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await encerrarCompromisso(fromPostgres(getSql()), id, formData.get("reabrir") === null);
  revalidar();
}

export async function adicionarChamada(formData: FormData): Promise<void> {
  await requireSession();

  const compromissoId = String(formData.get("commitmentId") ?? "");
  const valor = dinheiro(formData.get("amount"));
  const quando = data(formData.get("calledOn"));
  if (!compromissoId || valor === null || !quando) return;

  await registrarChamada(fromPostgres(getSql()), {
    commitmentId: compromissoId,
    calledOn: quando,
    amount: valor,
    note: texto(formData.get("note")),
  });

  revalidar();
}

export async function editarChamada(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  const valor = dinheiro(formData.get("amount"));
  const quando = data(formData.get("calledOn"));
  if (!id || valor === null || !quando) return;

  await salvarChamada(fromPostgres(getSql()), id, {
    calledOn: quando,
    amount: valor,
    note: texto(formData.get("note")),
  });

  revalidar();
}

/**
 * Marca a chamada como paga, ou desfaz.
 *
 * O estado alvo vem no formulario e nao e deduzido aqui: dois cliques rapidos
 * na mesma linha alternariam duas vezes a partir de leituras diferentes, e o
 * resultado dependeria da ordem em que os pedidos chegassem.
 */
export async function liquidar(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await liquidarChamada(fromPostgres(getSql()), id, formData.get("desfazer") === null);
  revalidar();
}

export async function removerChamada(formData: FormData): Promise<void> {
  await requireSession();

  const id = String(formData.get("id") ?? "");
  if (!id) return;

  await apagarChamada(fromPostgres(getSql()), id);
  revalidar();
}
