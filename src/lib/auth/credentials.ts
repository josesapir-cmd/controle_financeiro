import "server-only";

import { randomBytes } from "node:crypto";
import { fingerprint, safeEqual } from "@/lib/crypto";
import { fromPostgres, type Db } from "@/lib/db/adapter";
import { getSql } from "@/lib/db/client";
import { CHALLENGE_MINUTES, ehPapel, semColunaDePapel, type Papel } from "./config";

/**
 * Passkeys, desafios e codigo de recuperacao.
 *
 * O app tem um unico dono. Nao ha cadastro de usuarios: a primeira passkey e
 * registrada sem autenticacao — e a unica janela de bootstrap — e, a partir
 * dai, registrar outra exige estar autenticado. Isso fecha a janela sozinho,
 * sem depender de o dono lembrar de desligar um interruptor.
 *
 * A assistente entra por convite: o dono gera um codigo, ela o digita na tela
 * de entrada e registra a passkey dela, que nasce com papel de assistente. O
 * papel e da CREDENCIAL, entao nao ha como uma passkey de assistente abrir uma
 * sessao de dono.
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
  papel: Papel;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export async function listCredentials(): Promise<StoredCredential[]> {
  let linhas: Record<string, unknown>[];
  try {
    linhas = await db().query<Record<string, unknown>>(
      `SELECT id, public_key, counter, transports, label, role, created_at, last_used_at
         FROM credentials ORDER BY created_at`,
    );
  } catch (erro) {
    // Antes da migracao 027 toda credencial e do dono; ver `semColunaDePapel`.
    if (!semColunaDePapel(erro)) throw erro;
    linhas = (
      await db().query<Record<string, unknown>>(
        `SELECT id, public_key, counter, transports, label, created_at, last_used_at
           FROM credentials ORDER BY created_at`,
      )
    ).map((linha) => ({ ...linha, role: "dono" }));
  }

  return (
    linhas
      // Papel desconhecido nao autentica ninguem, em vez de virar dono.
      .filter((linha) => ehPapel(linha.role))
      .map((linha) => ({
        id: String(linha.id),
        publicKey: new Uint8Array(linha.public_key as Buffer),
        counter: Number(linha.counter),
        transports: (linha.transports as string[] | null) ?? null,
        label: linha.label ? String(linha.label) : null,
        papel: linha.role as Papel,
        createdAt: new Date(linha.created_at as string),
        lastUsedAt: linha.last_used_at ? new Date(linha.last_used_at as string) : null,
      }))
  );
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
  papel: Papel;
}): Promise<void> {
  // O conflito so atualiza o contador, nunca o papel: registrar de novo a
  // mesma credencial por um convite de assistente nao rebaixa nem promove
  // ninguem.
  await db().query(
    `INSERT INTO credentials (id, public_key, counter, transports, label, role)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (id) DO UPDATE SET counter = EXCLUDED.counter`,
    [
      credencial.id,
      Buffer.from(credencial.publicKey),
      credencial.counter,
      credencial.transports ?? null,
      credencial.label ?? null,
      credencial.papel,
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

/**
 * Pega o desafio de registro e diz com que autorizacao ele foi emitido.
 *
 * O registro tem duas etapas — pedir as opcoes e verificar a resposta — e a
 * autorizacao e decidida na primeira. Ela viaja no proposito do desafio, que
 * so o servidor escreve, em vez de o codigo ser conferido duas vezes: um
 * codigo de uso unico consumido na primeira etapa faltaria na segunda.
 */
export async function takeRegistrationChallenge(
  id: string,
): Promise<{ challenge: string; purpose: string } | null> {
  const linhas = await db().query<{ challenge: string; purpose: string }>(
    `DELETE FROM auth_challenges
      WHERE id = $1 AND purpose LIKE 'registro:%' AND expires_at > now()
      RETURNING challenge, purpose`,
    [id],
  );

  await db().query("DELETE FROM auth_challenges WHERE expires_at <= now()");

  return linhas[0] ?? null;
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

/**
 * Codigo curto e temporario para registrar um dispositivo novo.
 *
 * Existe para que adicionar o celular nao gaste o codigo de recuperacao — que
 * deveria ficar guardado offline para a emergencia de perder todos os
 * dispositivos, nao ser digitado numa tela de cafe.
 *
 * Curto porque sera digitado a mao; de vida curta e uso unico porque e curto.
 * Seis caracteres so sao seguros o suficiente por expirarem em dez minutos:
 * fossem permanentes, seriam adivinhaveis.
 */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export async function createDeviceCode(): Promise<string> {
  const bytes = randomBytes(6);
  // Alfabeto sem 0/O e 1/I/L: o codigo e lido de uma tela e digitado noutra.
  const codigo = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");

  const expira = new Date(Date.now() + 10 * 60 * 1000);
  await db().query(
    "INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4)",
    [`device-${codigo}`, fingerprint("device", codigo), "dispositivo", expira.toISOString()],
  );

  return codigo;
}

/**
 * Codigos de uso unico guardados em `auth_challenges`: o de dispositivo novo e
 * o convite da assistente. Os dois sao conferidos na primeira etapa do
 * registro e consumidos so na ultima — consumir antes faria uma biometria
 * cancelada queimar o codigo.
 */
const CODIGOS = {
  dispositivo: { prefixo: "device-", dominio: "device", proposito: "dispositivo" },
  convite: { prefixo: "convite-", dominio: "convite", proposito: "convite-assistente" },
} as const;

type TipoDeCodigo = keyof typeof CODIGOS;

const limparCodigo = (codigo: string) => codigo.trim().toUpperCase().replace(/[\s-]/g, "");

/** O codigo existe, esta valido, e e deste tipo. Nao consome. */
export async function codigoValido(tipo: TipoDeCodigo, codigo: string): Promise<boolean> {
  const c = CODIGOS[tipo];
  const limpo = limparCodigo(codigo);
  if (!limpo) return false;

  const linhas = await db().query<{ challenge: string }>(
    `SELECT challenge FROM auth_challenges
      WHERE id = $1 AND purpose = $2 AND expires_at > now()`,
    [`${c.prefixo}${limpo}`, c.proposito],
  );

  const guardado = linhas[0]?.challenge;
  return Boolean(guardado) && safeEqual(guardado, fingerprint(c.dominio, limpo));
}

/** Consome o codigo: vale uma vez so. Falso se ja foi usado ou venceu. */
export async function consumirCodigo(tipo: TipoDeCodigo, codigo: string): Promise<boolean> {
  const c = CODIGOS[tipo];
  const limpo = limparCodigo(codigo);
  if (!limpo) return false;

  const linhas = await db().query<{ challenge: string }>(
    `DELETE FROM auth_challenges
      WHERE id = $1 AND purpose = $2 AND expires_at > now()
      RETURNING challenge`,
    [`${c.prefixo}${limpo}`, c.proposito],
  );

  const guardado = linhas[0]?.challenge;
  return Boolean(guardado) && safeEqual(guardado, fingerprint(c.dominio, limpo));
}

/** Validade do convite. Longa, porque ele vai por mensagem e pode esperar. */
export const CONVITE_HORAS = 48;

/**
 * Convite para a assistente registrar a passkey dela.
 *
 * Oito caracteres, e nao seis como o de dispositivo: este vale dois dias, e
 * um codigo que fica valido mais tempo precisa ser mais dificil de adivinhar.
 * Um convite novo invalida os anteriores ainda nao usados — o ultimo enviado e
 * o unico que deveria funcionar.
 */
export async function createAssistantInvite(): Promise<string> {
  const bytes = randomBytes(8);
  const codigo = Array.from(bytes, (b) => ALFABETO[b % ALFABETO.length]).join("");

  await db().query("DELETE FROM auth_challenges WHERE purpose = $1", [
    CODIGOS.convite.proposito,
  ]);

  const expira = new Date(Date.now() + CONVITE_HORAS * 60 * 60 * 1000);
  await db().query(
    "INSERT INTO auth_challenges (id, challenge, purpose, expires_at) VALUES ($1, $2, $3, $4)",
    [
      `${CODIGOS.convite.prefixo}${codigo}`,
      fingerprint(CODIGOS.convite.dominio, codigo),
      CODIGOS.convite.proposito,
      expira.toISOString(),
    ],
  );

  return codigo;
}

/** Ha convite valido, e ate quando — para o painel do dono. */
export async function pendingAssistantInvite(): Promise<Date | null> {
  const linhas = await db().query<{ expires_at: string }>(
    `SELECT expires_at FROM auth_challenges
      WHERE purpose = $1 AND expires_at > now()
      ORDER BY expires_at DESC LIMIT 1`,
    [CODIGOS.convite.proposito],
  );
  return linhas[0] ? new Date(linhas[0].expires_at) : null;
}

/**
 * Corta o acesso da assistente: credenciais, sessoes abertas e convite
 * pendente. As sessoes saem junto porque apagar so a passkey deixaria quem ja
 * esta dentro continuar dentro ate a sessao vencer — e sao 30 dias.
 */
export async function revokeAssistant(): Promise<void> {
  await db().query("DELETE FROM sessions WHERE role = 'assistente'");
  await db().query("DELETE FROM credentials WHERE role = 'assistente'");
  await db().query("DELETE FROM auth_challenges WHERE purpose = $1", [
    CODIGOS.convite.proposito,
  ]);
}
