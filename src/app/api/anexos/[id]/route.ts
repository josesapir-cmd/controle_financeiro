import { requireAcessoDaAssistente } from "@/lib/auth/guard";
import { fromPostgres } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { lancamentoDoSaldoCompartilhado, lerAnexo } from "@/lib/db/repository";
import { abreNoNavegador } from "@/lib/anexos";

export const dynamic = "force-dynamic";

/**
 * Devolve o arquivo anexado.
 *
 * O dono abre qualquer anexo; a assistente, so os de lancamentos do saldo
 * compartilhado — conferido aqui, e nao so na tela que mostra o link.
 *
 * Os cabecalhos sao a segunda linha de defesa depois da lista de tipos aceitos
 * e da assinatura conferida no envio: `nosniff` impede o navegador de tratar o
 * arquivo como outra coisa, e `sandbox` faz a imagem aberta em aba propria
 * rodar sem acesso ao app. PDF fica sem `sandbox` porque o Chrome se recusa a
 * mostrar PDF em documento isolado — ele abre no leitor do navegador, que nao
 * roda no contexto do app.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const papel = await requireAcessoDaAssistente();
  const { id } = await params;

  const db = fromPostgres(getSql());
  const anexo = await lerAnexo(db, id);

  const naoEncontrado = () => new Response("Nao encontrado.", { status: 404 });
  if (!anexo) return naoEncontrado();
  if (papel !== "dono" && !(await lancamentoDoSaldoCompartilhado(db, anexo.transactionId))) {
    // 404, e nao 403: para quem nao pode ver, o anexo nao existe.
    return naoEncontrado();
  }

  const nome = anexo.nome.replace(/["\\\r\n]/g, "_");
  const disposicao = abreNoNavegador(anexo.tipo) ? "inline" : "attachment";

  return new Response(new Uint8Array(anexo.conteudo), {
    headers: {
      "Content-Type": anexo.tipo,
      "Content-Length": String(anexo.conteudo.length),
      "Content-Disposition": `${disposicao}; filename*=UTF-8''${encodeURIComponent(nome)}`,
      "X-Content-Type-Options": "nosniff",
      ...(anexo.tipo.startsWith("image/")
        ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'" }
        : {}),
      "Cache-Control": "private, no-store",
    },
  });
}
