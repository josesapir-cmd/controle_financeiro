import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { anexarImportacao, criarImportacao, lerImportacao } from "@/lib/db/repository";
import { localDay } from "@/lib/finance/dates";
import { TAMANHO_MAXIMO_BYTES, tipoAceito } from "@/lib/importacao/limites";
import { mesclar, suspeitasDeDuplicata, type Linha } from "@/lib/importacao/linhas";
import { mesclarPedidos, type Pedido } from "@/lib/importacao/pedidos";
import { lerPrints, type Imagem } from "@/lib/importacao/prints";

export const dynamic = "force-dynamic";
/** Ler um bloco de imagens leva mais do que o limite curto padrao. */
export const maxDuration = 300;

/**
 * Recebe um bloco da fila de prints e devolve o lote atualizado.
 *
 * E rota, e nao server action, por causa do tamanho: server actions limitam o
 * corpo a 1 MB por padrao e um print de celular passa disso sozinho.
 *
 * A fila e da tela: ela quebra a selecao em blocos e chama aqui uma vez por
 * bloco, passando `lote` a partir do segundo. O servidor guarda o acumulado,
 * entao fechar a aba no meio nao perde o que ja foi lido — o lote continua
 * pendente, com as linhas que chegaram.
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

  const arquivos = formulario
    .getAll("prints")
    .filter((valor): valor is File => valor instanceof File);

  if (arquivos.length === 0) {
    return NextResponse.json({ error: "Nenhuma imagem enviada." }, { status: 400 });
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

  const db = fromPostgres(getSql());
  const loteExistente = String(formulario.get("lote") ?? "").trim();

  let anteriores: Linha[] = [];
  let pedidosAnteriores: Pedido[] = [];
  if (loteExistente) {
    const lote = await lerImportacao(db, loteExistente);
    if (!lote) {
      return NextResponse.json({ error: "Lote nao encontrado." }, { status: 404 });
    }
    if (lote.status !== "pendente") {
      return NextResponse.json(
        { error: "Este lote ja foi encerrado. Comece um envio novo." },
        { status: 409 },
      );
    }
    anteriores = lote.linhas as Linha[];
    pedidosAnteriores = lote.pedidos as Pedido[];
  }

  const envio = loteExistente
    ? Math.max(0, ...anteriores.map((linha) => linha.envio)) + 1
    : 1;

  try {
    const leitura = await lerPrints(imagens, localDay(new Date()), {
      envio,
      arquivos: arquivos.map((arquivo) => arquivo.name),
    });

    const linhas = mesclar(anteriores, leitura.linhas);
    const pedidos = mesclarPedidos(pedidosAnteriores, leitura.pedidos);

    // A imagem em si nao e guardada: ja cumpriu o papel, e um print de extrato
    // e mais dado sensivel para armazenar do que as linhas que saem dele.
    let id = loteExistente;
    if (id) {
      const anexou = await anexarImportacao(db, id, {
        linhas,
        pedidos,
        imagens: imagens.length,
        note: leitura.observacao,
      });
      if (!anexou) {
        return NextResponse.json(
          { error: "Este lote ja foi encerrado. Comece um envio novo." },
          { status: 409 },
        );
      }
    } else {
      id = await criarImportacao(db, {
        linhas,
        pedidos,
        images: imagens.length,
        note: leitura.observacao,
      });
    }

    return NextResponse.json({
      id,
      envio,
      linhas: linhas.length,
      novas: leitura.linhas.length,
      rejeitadas: leitura.rejeitadas.length,
      duplicadas: suspeitasDeDuplicata(linhas).length,
      pedidos: pedidos.length,
      observacao: leitura.observacao,
    });
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Nao foi possivel ler os prints.";
    return NextResponse.json({ error: mensagem, lote: loteExistente || null }, { status: 502 });
  }
}
