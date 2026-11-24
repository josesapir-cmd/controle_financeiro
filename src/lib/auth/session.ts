import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { SESSION_COOKIE, SESSION_DAYS, ehPapel, semColunaDePapel, type Papel } from "./config";

/**
 * Sessoes guardadas no banco, nao assinadas em cookie.
 *
 * Um token opaco permite revogar acesso de verdade — apagar a linha encerra a
 * sessao na hora. Um cookie assinado so expiraria sozinho, e num app que expoe
 * historico financeiro a capacidade de cortar acesso imediatamente importa mais
 * que economizar uma consulta.
 *
 * A sessao carrega o papel de quem entrou. E dela que cada pagina le o que
 * pode mostrar, e nao do cookie: o cookie e so o numero da sessao.
 */

function db(): Db {
  return fromPostgres(getSql());
}

export interface Sessao {
  id: string;
  papel: Papel;
}

export async function createSession(userAgent: string | null, papel: Papel): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  try {
    await db().query(
      "INSERT INTO sessions (id, expires_at, user_agent, role) VALUES ($1, $2, $3, $4)",
      [id, expiraEm.toISOString(), userAgent, papel],
    );
  } catch (erro) {
    // Antes da migracao 027 so o dono existe; ver `semColunaDePapel`.
    if (!semColunaDePapel(erro) || papel !== "dono") throw erro;
    await db().query(
      "INSERT INTO sessions (id, expires_at, user_agent) VALUES ($1, $2, $3)",
      [id, expiraEm.toISOString(), userAgent],
    );
  }

  const jar = await cookies();
  jar.set(SESSION_COOKIE, id, {
    httpOnly: true,
    // Em producao o app so responde por HTTPS; em desenvolvimento, localhost
    // nao tem certificado e o cookie seria descartado.
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiraEm,
  });

  return id;
}

export async function currentSession(): Promise<Sessao | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  let linhas: { id: string; role?: unknown }[];
  try {
    linhas = await db().query<{ id: string; role: unknown }>(
      "SELECT id, role FROM sessions WHERE id = $1 AND expires_at > now()",
      [id],
    );
  } catch (erro) {
    if (!semColunaDePapel(erro)) throw erro;
    linhas = (
      await db().query<{ id: string }>(
        "SELECT id FROM sessions WHERE id = $1 AND expires_at > now()",
        [id],
      )
    ).map((l) => ({ id: l.id, role: "dono" }));
  }

  const linha = linhas[0];
  if (!linha) return null;

  // Papel desconhecido nao vira dono: sessao sem papel valido nao existe.
  return ehPapel(linha.role) ? { id: linha.id, papel: linha.role } : null;
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;

  if (id) await db().query("DELETE FROM sessions WHERE id = $1", [id]);
  jar.delete(SESSION_COOKIE);
}

/** Remove sessoes vencidas. Chamado no login, que ja toca o banco de qualquer forma. */
export async function pruneSessions(): Promise<void> {
  await db().query("DELETE FROM sessions WHERE expires_at <= now()");
}
