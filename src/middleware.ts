import { NextResponse, type NextRequest } from "next/server";

/**
 * Desvio antecipado de quem nao esta autenticado.
 *
 * NAO e o controle de acesso: roda no runtime de borda, sem banco, entao so
 * consegue ver se ha um cookie de sessao — e um cookie forjado passaria. A
 * verificacao de verdade e requireSession(), no servidor, contra o banco, no
 * topo de cada pagina e cada acao.
 *
 * Existe para evitar renderizar e consultar dados de quem vai ser mandado para
 * a tela de entrada de qualquer forma.
 */
const PUBLICAS = ["/entrar", "/api/auth"];

export function middleware(request: NextRequest) {
  const caminho = request.nextUrl.pathname;

  if (PUBLICAS.some((rota) => caminho.startsWith(rota))) return NextResponse.next();

  // A sincronizacao se autentica por segredo proprio, nao por sessao: ela e
  // chamada pelo cron, que nao tem navegador nem cookie.
  if (caminho.startsWith("/api/sync")) return NextResponse.next();

  if (!request.cookies.get("cf_session")) {
    const destino = new URL("/entrar", request.url);
    return NextResponse.redirect(destino);
  }

  return NextResponse.next();
}

export const config = {
  // Exclui TODO o /_next, nao apenas static e image. Em desenvolvimento o
  // Turbopack usa outros caminhos sob /_next para o hot reload, e redireciona-los
  // para /entrar quebra a recarga automatica — o sintoma e um "Failed to fetch"
  // no console, sem relacao aparente com autenticacao.
  matcher: ["/((?!_next|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)"],
};
