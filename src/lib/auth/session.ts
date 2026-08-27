import "server-only";

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { SESSION_COOKIE, SESSION_DAYS } from "./config";

/**
 * Sessoes guardadas no banco, nao assinadas em cookie.
 *
 * Um token opaco permite revogar acesso de verdade — apagar a linha encerra a
 * sessao na hora. Um cookie assinado so expiraria sozinho, e num app que expoe
 * historico financeiro a capacidade de cortar acesso imediatamente importa mais
 * que economizar uma consulta.
 */

function db(): Db {
  return fromPostgres(getSql());
}

export async function createSession(userAgent: string | null): Promise<string> {
  const id = randomBytes(32).toString("base64url");
  const expiraEm = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  await db().query(
    "INSERT INTO sessions (id, expires_at, user_agent) VALUES ($1, $2, $3)",
    [id, expiraEm.toISOString(), userAgent],
  );

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

export async function currentSession(): Promise<{ id: string } | null> {
  const jar = await cookies();
  const id = jar.get(SESSION_COOKIE)?.value;
  if (!id) return null;

  const linhas = await db().query<{ id: string }>(
    "SELECT id FROM sessions WHERE id = $1 AND expires_at > now()",
    [id],
  );

  return linhas[0] ?? null;
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
