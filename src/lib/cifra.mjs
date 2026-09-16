import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM em JavaScript puro, com a chave recebida por parametro.
 *
 * Mesma razao do `fingerprint.mjs`: o app e os scripts de linha de comando
 * precisam ler exatamente o mesmo formato. Duplicar isso em dois lugares seria
 * criar a chance de eles divergirem, e o sintoma seria um script que devolve
 * lixo — ou nada — para dados que a tela le sem problema.
 *
 * `crypto.ts` continua sendo a porta de entrada do app: e la que a chave e
 * lida do ambiente e validada. Aqui so mora o algoritmo.
 *
 * Formato: "v1.<nonce base64url>.<cifra+tag base64url>".
 */

const VERSAO = "v1";
const ALGORITMO = "aes-256-gcm";
const TAMANHO_NONCE = 12;
const TAMANHO_TAG = 16;

/**
 * @param {Buffer} chave 32 bytes
 * @param {string} texto
 * @returns {string}
 */
export function cifrarCom(chave, texto) {
  const nonce = randomBytes(TAMANHO_NONCE);
  const cifrador = createCipheriv(ALGORITMO, chave, nonce);

  const cifrado = Buffer.concat([cifrador.update(texto, "utf8"), cifrador.final()]);
  const tag = cifrador.getAuthTag();

  return [
    VERSAO,
    nonce.toString("base64url"),
    Buffer.concat([cifrado, tag]).toString("base64url"),
  ].join(".");
}

/**
 * @param {Buffer} chave 32 bytes
 * @param {string} guardado
 * @returns {string}
 */
export function decifrarCom(chave, guardado) {
  const partes = guardado.split(".");
  if (partes.length !== 3 || partes[0] !== VERSAO) {
    throw new Error("Valor cifrado em formato desconhecido.");
  }

  const nonce = Buffer.from(partes[1], "base64url");
  const corpo = Buffer.from(partes[2], "base64url");

  const cifrado = corpo.subarray(0, corpo.length - TAMANHO_TAG);
  const tag = corpo.subarray(corpo.length - TAMANHO_TAG);

  const decifrador = createDecipheriv(ALGORITMO, chave, nonce);
  decifrador.setAuthTag(tag);

  return Buffer.concat([decifrador.update(cifrado), decifrador.final()]).toString("utf8");
}

/**
 * Le a chave do ambiente, com a mensagem de erro que diz como gerar uma.
 * @returns {Buffer}
 */
export function lerChaveDoAmbiente() {
  const bruta = process.env.APP_ENCRYPTION_KEY;
  if (!bruta) {
    throw new Error("APP_ENCRYPTION_KEY nao definida. Gere com: openssl rand -base64 32");
  }

  const chave = Buffer.from(bruta, "base64");
  if (chave.length !== 32) {
    throw new Error(`APP_ENCRYPTION_KEY precisa ter 32 bytes em base64; recebeu ${chave.length}.`);
  }

  return chave;
}
