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

/**
 * Quem esta do outro lado da sessao.
 *
 * O dono ve tudo. A assistente ve uma tela so — enviar prints do saldo
 * compartilhado e classificar aqueles lancamentos —, e o resto do app nao
 * existe para ela.
 */
export type Papel = "dono" | "assistente";

export function ehPapel(valor: unknown): valor is Papel {
  return valor === "dono" || valor === "assistente";
}

/**
 * A coluna `role` ainda nao existe: o deploy chegou antes da migracao 027.
 *
 * So nessa janela vale tratar a sessao como do dono — antes da migracao nao ha
 * como existir credencial de assistente, entao nao ha a quem dar acesso a mais.
 * Qualquer outro erro sobe.
 */
export function semColunaDePapel(erro: unknown): boolean {
  const e = erro as { code?: string; message?: string } | null;
  return e?.code === "42703" || /column "role" does not exist/.test(String(e?.message ?? ""));
}
