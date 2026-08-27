import { createHmac } from "node:crypto";

/**
 * Identificador deterministico e nao reversivel, para agrupar no SQL sem
 * guardar o dado em claro.
 *
 * Em JavaScript puro porque tanto o app quanto os scripts de linha de comando
 * precisam gerar exatamente o mesmo valor — duplicar essa logica em dois
 * lugares seria criar a chance de eles divergirem, e o sintoma seria um
 * cadastro que silenciosamente deixa de casar com as transacoes.
 *
 * @param {Buffer} chave
 * @param {string} dominio  separa espacos de chave, para que o mesmo documento
 *                          usado em contextos diferentes nao colida
 * @param {string} valor
 * @returns {string}
 */
export function fingerprintWith(chave, dominio, valor) {
  return createHmac("sha256", chave)
    .update(`${dominio}:${valor.trim().toLowerCase()}`)
    .digest("base64url");
}
