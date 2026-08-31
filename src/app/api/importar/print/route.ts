import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { criarImportacao } from "@/lib/db/repository";
import { localDay } from "@/lib/finance/dates";
import {
  MAXIMO_DE_IMAGENS,
  TAMANHO_MAXIMO_BYTES,
  tipoAceito,
} from "@/lib/importacao/limites";
import { lerPrints, type Imagem } from "@/lib/importacao/prints";

export const dynamic = "force-dynamic";
/** Ler varias imagens leva mais do que o limite curto padrao. */
export const maxDuration = 300;

/**
 * Recebe prints do saldo compartilhado e devolve um lote para conferencia.
 *
 * E rota, e nao server action, por causa do tamanho: server actions limitam o
 * corpo a 1 MB por padrao e um print de celular passa disso sozinho.
 *
 * Nada e gravado como lancamento aqui. A rota so guarda a leitura; quem decide
 * o que entra no controle e a tela de conferencia.
 */
export async function POST(request: Request): Promise<Response> {
  await requireSession();

  let formulario: FormData;
  try {
    formulario = await request.formData();
  } catch {
    return NextResponse.json({ error: "Envio invalido." }, { status: 400 });
  }

  const arquivos = formulario.getAll("prints").filter((valor): valor is File => valor instanceof File);

  if (arquivos.length === 0) {
    return NextResponse.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
  }
  if (arquivos.length > MAXIMO_DE_IMAGENS) {
    return NextResponse.json(
      { error: `Envie no maximo ${MAXIMO_DE_IMAGENS} imagens por vez.` },
      { status: 400 },
    );
  }

  const imagens: Imagem[] = [];
  for (const arquivo of arquivos) {
    if (!tipoAceito(arquivo.type)) {
      return NextResponse.json(
        { error: `"${arquivo.name}" nao e uma imagem PNG, JPEG, WebP ou GIF.` },
        { status: 400 },
      );
    }
    if (arquivo.size > TAMANHO_MAXIMO_BYTES) {
      return NextResponse.json(
        { error: `"${arquivo.name}" passa de ${TAMANHO_MAXIMO_BYTES / 1024 / 1024} MB.` },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await arquivo.arrayBuffer());
    imagens.push({ midia: arquivo.type, base64: bytes.toString("base64") });
  }

  try {
    const leitura = await lerPrints(imagens, localDay(new Date()));

    // A imagem em si nao e guardada: ja cumpriu o papel, e um print de extrato
    // e mais dado sensivel para armazenar do que as linhas que saem dele.
    const id = await criarImportacao(fromPostgres(getSql()), {
      linhas: leitura.linhas,
      images: imagens.length,
      note: leitura.observacao,
    });

    return NextResponse.json({
      id,
      linhas: leitura.linhas.length,
      rejeitadas: leitura.rejeitadas.length,
      observacao: leitura.observacao,
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Nao foi possivel ler os prints.";
    return NextResponse.json({ error: mensagem }, { status: 502 });
  }
}
