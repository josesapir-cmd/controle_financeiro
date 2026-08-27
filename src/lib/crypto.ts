import "server-only";

import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Criptografia de campos identificadores.
 *
 * AES-256-GCM com nonce aleatorio por valor. GCM autentica junto com cifrar: um
 * texto adulterado falha ao decifrar em vez de devolver lixo silenciosamente.
 *
 * O que isto protege: quem obtiver acesso de leitura ao banco — o vazamento mais
 * provavel — ve quanto e quando, mas nao de quem nem do que. A criptografia do
 * provedor cobre roubo de disco; esta cobre credencial de banco exposta.
 *
 * O que isto nao protege: comprometimento do ambiente do app, onde a chave vive.
 * Nao ha como agregar no banco sem a chave em algum lugar, e aceitar isso foi
 * uma decisao consciente (ver docs/arquitetura.md).
 *
 * Formato do valor guardado: "v1.<nonce base64url>.<cifra+tag base64url>".
 * O prefixo de versao existe para permitir trocar de algoritmo depois sem
 * precisar adivinhar o formato de cada linha antiga.
 */

const VERSAO = "v1";
const ALGORITMO = "aes-256-gcm";
const TAMANHO_NONCE = 12;
const TAMANHO_CHAVE = 32;

let chaveEmCache: Buffer | null = null;

function lerChave(): Buffer {
  if (chaveEmCache) return chaveEmCache;

  const bruta = process.env.APP_ENCRYPTION_KEY;
  if (!bruta) {
    throw new Error(
      "APP_ENCRYPTION_KEY nao definida. Gere com: openssl rand -base64 32",
    );
  }

  const chave = Buffer.from(bruta, "base64");
  if (chave.length !== TAMANHO_CHAVE) {
    throw new Error(
      `APP_ENCRYPTION_KEY precisa ter 32 bytes em base64; recebeu ${chave.length}.`,
    );
  }

  chaveEmCache = chave;
  return chave;
}

/** Exposto para os testes, que trocam a chave entre casos. */
export function resetKeyCache(): void {
  chaveEmCache = null;
}

export function encrypt(texto: string): string {
  const nonce = randomBytes(TAMANHO_NONCE);
  const cifrador = createCipheriv(ALGORITMO, lerChave(), nonce);

  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    nonce.toString("base64url"),
    Buffer.concat([cifrado, tag]).toString("base64url"),
  ].join(".");
}

export function decrypt(guardado: string): string {
  const partes = guardado.split(".");
  if (partes.length !== 3 || partes[0] !== VERSAO) {
    throw new Error("Valor cifrado em formato desconhecido.");
  }

  const nonce = Buffer.from(partes[1], "base64url");
  const corpo = Buffer.from(partes[2], "base64url");

  const cifrado = corpo.subarray(0, corpo.length - 16);
  const tag = corpo.subarray(corpo.length - 16);

  const decifrador = createDecipheriv(ALGORITMO, lerChave(), nonce);
  decifrador.setAuthTag(tag);

  return Buffer.concat([decifrador.update(cifrado), decifrador.final()]).toString("utf8");
}

/** Cifra apenas quando ha conteudo, para nao encher o banco de nulos cifrados. */
export function encryptOptional(texto: string | null | undefined): string | null {
  return texto ? encrypt(texto) : null;
}

export function decryptOptional(guardado: string | null | undefined): string | null {
  return guardado ? decrypt(guardado) : null;
}

/**
 * Comparacao de tempo constante para segredos curtos, como o codigo de
 * recuperacao. Comparar com === vaza, pelo tempo de resposta, quantos
 * caracteres iniciais estao certos.
 */
export function safeEqual(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) return false;
  return timingSafeEqual(bufferA, bufferB);
}

/**
 * Identificador deterministico e nao reversivel, para agrupar no SQL sem
 * guardar o dado em claro.
 *
 * Cifra com nonce aleatorio nao serve aqui: dois valores iguais produzem cifras
 * diferentes de proposito, entao nao da para agrupar por elas. HMAC resolve —
 * mesmo valor, mesmo hash — e, por depender da chave secreta, nao e passivel de
 * ataque de dicionario: sem a chave, varrer os 10^11 CPFs possiveis nao ajuda.
 *
 * O `dominio` separa espacos de chave, para que o hash de um CPF como
 * contraparte nunca colida com o mesmo CPF usado em outro contexto.
 */
export function fingerprint(dominio: string, valor: string): string {
  return createHmac("sha256", lerChave())
    .update(`${dominio}:${valor.trim().toLowerCase()}`)
    .digest("base64url");
}
