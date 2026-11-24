import { NextResponse } from "next/server";
import { requireAcessoDaAssistente } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { gravarAnexo, lancamentoDoSaldoCompartilhado } from "@/lib/db/repository";
import {
  ANEXO_TAMANHO_MAXIMO,
  assinaturaConfere,
  tamanhoLegivel,
  tipoDeAnexoAceito,
} from "@/lib/anexos";

export const dynamic = "force-dynamic";

/**
 * Anexa um arquivo a um lancamento do saldo compartilhado.
 *
 * Rota, e nao server action, pelo tamanho: acao de servidor limita o corpo a
 * 1 MB, e a foto de um recibo tirada no celular passa disso.
 *
 * So lancamento do saldo compartilhado, tanto para a assistente quanto para o
 * dono: e o escopo da tela que envia. O id vem do formulario, e e aqui que se
 * confere que ele nao aponta para outra conta.
 */
export async function POST(request: Request): Promise<Response> {
  const papel = await requireAcessoDaAssistente();

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return NextResponse.json({ error: "Envio invalido." }, { status: 400 });
  }

  const transactionId = String(formulario.get("transactionId") ?? "");
  const arquivo = formulario.get("arquivo");
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ error: "Nenhum arquivo enviado." }, { status: 400 });
  }

  const db = fromPostgres(getSql());
  if (!(await lancamentoDoSaldoCompartilhado(db, transactionId))) {
    return NextResponse.json({ error: "Lancamento nao encontrado." }, { status: 404 });
  }

  if (!tipoDeAnexoAceito(arquivo.type)) {
    return NextResponse.json(
      { error: `"${arquivo.name}" nao e PDF nem imagem (PNG, JPEG, WebP, GIF, HEIC).` },
      { status: 400 },
    );
  }
  if (arquivo.size > ANEXO_TAMANHO_MAXIMO) {
    return NextResponse.json(
      {
        error: `"${arquivo.name}" tem ${tamanhoLegivel(arquivo.size)}; o limite e ${tamanhoLegivel(ANEXO_TAMANHO_MAXIMO)}.`,
      },
      { status: 400 },
    );
  }

  const conteudo = Buffer.from(await arquivo.arrayBuffer());
  if (!assinaturaConfere(arquivo.type, conteudo)) {
    return NextResponse.json(
      { error: `"${arquivo.name}" nao parece ser o que a extensao diz.` },
      { status: 400 },
    );
  }

  const id = await gravarAnexo(db, {
    transactionId,
    nome: arquivo.name || "anexo",
    tipo: arquivo.type,
    conteudo,
    criadoPor: papel,
  });

  return NextResponse.json({ id });
}
