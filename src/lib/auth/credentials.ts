import "server-only";

import { randomBytes } from "node:crypto";
import { fingerprint, safeEqual } from "@/lib/crypto";
import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { CHALLENGE_MINUTES } from "./config";

/**
 * Passkeys, desafios e codigo de recuperacao.
 *
 * O app tem um unico dono. Nao ha cadastro de usuarios: a primeira passkey e
 * registrada sem autenticacao — e a unica janela de bootstrap — e, a partir
 * dai, registrar outra exige estar autenticado. Isso fecha a janela sozinho,
 * sem depender de o dono lembrar de desligar um interruptor.
 */

function db(): Db {
  return fromPostgres(getSql());
}

export interface StoredCredential {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports: string[] | null;
  label: string | null;
}

export async function listCredentials(): Promise<StoredCredential[]> {
  const linhas = await db().query<Record<string, unknown>>(
    "SELECT id, public_key, counter, transports, label FROM credentials ORDER BY created_at",
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    publicKey: new Uint8Array(linha.public_key as Buffer),
    counter: Number(linha.counter),
    transports: (linha.transports as string[] | null) ?? null,
    label: linha.label ? String(linha.label) : null,
  }));
}

export async function hasCredentials(): Promise<boolean> {
  const linhas = await db().query<{ total: string }>("SELECT count(*) AS total FROM credentials");
  return Number(linhas[0]?.total ?? 0) > 0;
}

export async function saveCredential(credencial: {
  id: string;
  publicKey: Uint8Array;
  counter: number;
  transports?: string[];
  label?: string;
}): Promise<void> {
  await db().query(
    `INSERT INTO credentials (id, public_key, counter, transports, label)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET counter = EXCLUDED.counter`,
    [
      credencial.id,
      Buffer.from(credencial.publicKey),
      credencial.counter,
      credencial.transports ?? null,
      credencial.label ?? null,
    ],
  );
}

/**
 * O contador cresce a cada uso e detecta credencial clonada: se voltar atras, a
 * mesma chave foi usada em dois lugares.
 */
export async function updateCounter(id: string, counter: number): Promise<void> {
  await db().query(
    "UPDATE credentials SET counter = $2, last_used_at = now() WHERE id = $1",
    [id, counter],
  );
}

export async function saveChallenge(purpose: string, challenge: string): Promise<string> {
  const id = randomBytes(16).toString("base64url");
  const expira = new Date(Date.now() + CHALLENGE_MINUTES * 60 * 1000);

  await db().query(
    "INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4)",
    [id, challenge, purpose, expira.toISOString()],
  );

  return id;
}

/**
 * Consome o desafio: ele vale uma unica vez. Deixa-lo reutilizavel permitiria
 * repetir uma resposta capturada.
 */
export async function takeChallenge(id: string, purpose: string): Promise<string | null> {
  const linhas = await db().query<{ challenge: string }>(
    `DELETE FROM auth_challenges
      WHERE id = $1 AND purpose = $2 AND expires_at > now()
      RETURNING challenge`,
    [id, purpose],
  );

  // Aproveita para limpar os vencidos, sem precisar de rotina propria.
  await db().query("DELETE FROM auth_challenges WHERE expires_at <= now()");

  return linhas[0]?.challenge ?? null;
}

const CHAVE_RECUPERACAO = "recovery_code";

/**
 * Codigo de recuperacao, gerado uma vez no bootstrap.
 *
 * Guardado como HMAC, nunca em claro: quem ler o banco nao consegue usa-lo.
 * Serve para registrar uma passkey nova caso todos os dispositivos se percam —
 * sem ele, perder o celular e o computador significaria perder o app.
 */
export async function createRecoveryCode(): Promise<string> {
  const codigo = randomBytes(20)
    .toString("base64url")
    .replace(/[-_]/g, "")
    .slice(0, 24)
    .toUpperCase();

  await db().query(
    `INSERT INTO app_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [CHAVE_RECUPERACAO, fingerprint("recovery", codigo)],
  );

  return codigo;
}

export async function checkRecoveryCode(codigo: string): Promise<boolean> {
  const linhas = await db().query<{ value: string }>(
    "SELECT value FROM app_settings WHERE key = $1",
    [CHAVE_RECUPERACAO],
  );

  const guardado = linhas[0]?.value;
  if (!guardado) return false;

  return safeEqual(guardado, fingerprint("recovery", codigo.trim().toUpperCase()));
}
