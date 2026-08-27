import "server-only";

import { redirect } from "next/navigation";
import { currentSession } from "./session";

/**
 * Exige sessao valida. Chamada no topo de cada pagina e de cada acao.
 *
 * A verificacao acontece aqui, no servidor, contra o banco — nao no middleware.
 * O middleware roda no runtime de borda, sem acesso ao Postgres, entao so
 * consegue olhar se existe um cookie; um cookie forjado passaria por ele. Ele
 * serve para desviar cedo quem nao esta autenticado, nao como controle de
 * acesso.
 */
export async function requireSession(): Promise<void> {
  if (!(await currentSession())) redirect("/entrar");
}
