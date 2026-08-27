import "server-only";

/**
 * Parametros do WebAuthn.
 *
 * O `rpID` e o dominio e o `origin` e a URL completa: o navegador recusa a
 * autenticacao se qualquer um dos dois nao bater exatamente com o endereco em
 * uso. E de proposito — e o que impede um site clonado de reaproveitar a
 * credencial.
 */
export function authConfig() {
  const rpID = process.env.APP_DOMAIN || "localhost";
  const origin = process.env.APP_ORIGIN || `http://${rpID}:3210`;

  return {
    rpID,
    origin,
    rpName: "Controle Financeiro",
  };
}

/** Duracao da sessao. Longa por ser um app pessoal de um dispositivo confiavel. */
export const SESSION_DAYS = 30;

export const SESSION_COOKIE = "cf_session";

/** Desafios expiram rapido: sao de uso unico e imediato. */
export const CHALLENGE_MINUTES = 5;
