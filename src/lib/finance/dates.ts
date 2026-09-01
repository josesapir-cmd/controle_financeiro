/**
 * A Pluggy devolve datas em UTC com horario completo
 * ("2026-08-26T18:19:21.000Z"). Cortar os dez primeiros caracteres le a data em
 * UTC, o que joga toda transacao feita depois das 21h de Brasilia para o dia
 * seguinte — e, na virada do mes, para o mes seguinte.
 *
 * Toda comparacao de data no app passa por aqui.
 */

const FUSO = process.env.APP_TIMEZONE || "America/Sao_Paulo";

const formatador = new Intl.DateTimeFormat("en-CA", {
  timeZone: FUSO,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** Dia local no formato AAAA-MM-DD. */
export function localDay(date: Date | string): string {
  const valor = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(valor.getTime())) return "";
  // en-CA formata como AAAA-MM-DD, que e o que precisamos comparar.
  return formatador.format(valor);
}

/** Mes local no formato AAAA-MM. */
export function localMonth(date: Date | string): string {
  return localDay(date).slice(0, 7);
}

/** Primeiro dia do mes local e hoje. */
export function currentMonthRange(today: Date = new Date()): { from: string; to: string } {
  const hoje = localDay(today);
  return { from: `${hoje.slice(0, 7)}-01`, to: hoje };
}

/** Janela dos ultimos N dias, incluindo hoje. */
export function lastDaysRange(days: number, today: Date = new Date()): { from: string; to: string } {
  const inicio = new Date(today.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return { from: localDay(inicio), to: localDay(today) };
}

/** Ano corrente ate hoje. */
export function currentYearRange(today: Date = new Date()): { from: string; to: string } {
  const hoje = localDay(today);
  return { from: `${hoje.slice(0, 4)}-01-01`, to: hoje };
}

const formatadorHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: FUSO,
  hour: "2-digit",
  minute: "2-digit",
});

/** Hora local no formato HH:MM. */
export function localTime(date: Date | string): string {
  const valor = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(valor.getTime())) return "";
  return formatadorHora.format(valor);
}

/** Minutos desde a meia-noite local, para posicionar na linha do tempo. */
export function minutesOfDay(date: Date | string): number {
  const hora = localTime(date);
  if (!hora) return 0;
  const [h, m] = hora.split(":").map(Number);
  return h * 60 + m;
}

/** Mes vizinho, deslocado em N meses. Formato AAAA-MM. */
export function shiftMonth(month: string, delta: number): string {
  const [ano, mes] = month.split("-").map(Number);
  if (!ano || !mes) return month;

  // Meio do mes e dia 15 as 12h UTC: somar meses a partir do dia 1 tambem
  // funciona, mas o dia 15 sobrevive a qualquer aritmetica de fuso.
  const base = new Date(Date.UTC(ano, mes - 1 + delta, 15, 12));
  return base.toISOString().slice(0, 7);
}

/**
 * Primeiro e ultimo dia de um mes AAAA-MM.
 *
 * O mes corrente para em hoje, nao no dia 31: pedir ate o fim de um mes que
 * ainda nao acabou nao traz nada a mais e faz a tela prometer um periodo que
 * nao existe.
 */
export function monthRange(
  month: string,
  today: Date = new Date(),
): { from: string; to: string } {
  const [ano, mes] = month.split("-").map(Number);
  const hoje = localDay(today);
  const from = `${month}-01`;
  // Dia 0 do mes seguinte e o ultimo dia deste.
  const ultimo = new Date(Date.UTC(ano, mes, 0, 12)).toISOString().slice(0, 10);
  return { from, to: ultimo > hoje ? hoje : ultimo };
}

/** Dia vizinho, deslocado em N dias. */
export function shiftDay(day: string, delta: number): string {
  const base = new Date(`${day}T12:00:00Z`);
  base.setUTCDate(base.getUTCDate() + delta);
  return base.toISOString().slice(0, 10);
}

/**
 * Instante que cai no meio-dia do fuso local do dia informado.
 *
 * Serve para lancamentos que chegam sem horario — hoje, os lidos de print do
 * saldo compartilhado. Meio-dia porque e o ponto do dia mais distante das duas
 * viradas: qualquer conversao de fuso posterior continua caindo no mesmo dia.
 */
export function noonAt(day: string): Date {
  const candidato = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(candidato.getTime())) return candidato;

  // Meio-dia UTC nao e o mesmo dia local em fusos muito a leste ou a oeste;
  // corrigimos pela diferenca entre o dia que caiu e o que foi pedido.
  const desvio =
    Date.parse(`${localDay(candidato)}T00:00:00Z`) - Date.parse(`${day}T00:00:00Z`);
  return desvio === 0 ? candidato : new Date(candidato.getTime() - desvio);
}
