import "server-only";

import { redirect } from "next/navigation";
import type { Papel } from "./config";
import { currentSession } from "./session";

/**
 * Exige sessao DO DONO. Chamada no topo de cada pagina e de cada acao.
 *
 * A verificacao acontece aqui, no servidor, contra o banco — nao no middleware.
 * O middleware roda no runtime de borda, sem acesso ao Postgres, entao so
 * consegue olhar se existe um cookie; um cookie forjado passaria por ele. Ele
 * serve para desviar cedo quem nao esta autenticado, nao como controle de
 * acesso.
 *
 * O nome ficou o de antes de existir a assistente, e de proposito: cada
 * pagina e cada acao que ja chamava isto passou a ser do dono sem precisar ser
 * lembrada. O que a assistente pode ver e a excecao, declarada uma a uma com
 * `requireAcessoDaAssistente` — esquecer de declarar fecha, nao abre.
 */
export async function requireSession(): Promise<void> {
  const sessao = await currentSession();
  if (!sessao) redirect("/entrar");
  // A assistente nao recebe "acesso negado": e mandada para a unica tela que
  // e dela. Uma pagina de erro so diria que ha mais coisa aqui.
  if (sessao.papel !== "dono") redirect("/assistente");
}

/**
 * Exige sessao do dono OU da assistente, e devolve qual.
 *
 * So para o que a assistente pode usar: a tela dela, a leitura de prints e os
 * anexos. Quem chama decide o que mostrar com o papel devolvido.
 */
export async function requireAcessoDaAssistente(): Promise<Papel> {
  const sessao = await currentSession();
  if (!sessao) redirect("/entrar");
  return sessao.papel;
}
