/**
 * O pacote server-only lanca ao ser importado fora de um Server Component, o
 * que quebra os testes de unidade dos modulos que o usam para se proteger.
 * O vitest resolve o import para este arquivo vazio; em producao o pacote real
 * continua valendo.
 */
export {};
