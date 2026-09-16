import "server-only";

import { timingSafeEqual } from "node:crypto";

import { cifrarCom, decifrarCom } from "./cifra.mjs";

import { fingerprintWith } from "./fingerprint.mjs";

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
 *
 * O algoritmo em si mora em `cifra.mjs`, que os scripts de linha de comando
 * tambem importam — este modulo tem `server-only` e cuida da chave.
 */

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
  return cifrarCom(lerChave(), texto);
}

export function decrypt(guardado: string): string {
  return decifrarCom(lerChave(), guardado);
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
 * A implementacao vive em fingerprint.mjs para ser compartilhada com os scripts
 * de linha de comando, que precisam gerar exatamente o mesmo valor.
 */
export function fingerprint(dominio: string, valor: string): string {
  return fingerprintWith(lerChave(), dominio, valor);
}
