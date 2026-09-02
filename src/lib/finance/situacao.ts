/**
 * Situacao de um dia para a fita de datas.
 *
 * Tres estados, e o terceiro e o que importa: um dia sem despesa nenhuma pode
 * ser um domingo em casa ou um dia que o banco ainda nao mandou. Na tela sao
 * coisas opostas — num deles nao ha nada a fazer, no outro ha, so que ainda nao
 * da para fazer — e pinta-los igual seria mentir.
 */
export type SituacaoDoDia = "pendente" | "pronto" | "sem-dados";

/**
 * Ate que dia se pode afirmar que o extrato esta completo.
 *
 * E o MENOR ultimo-dia entre as contas: se o Itau reportou ate o dia 28 e o
 * Nubank ate o 31, os dias 29 a 31 estao incompletos, ainda que tenham
 * lancamento de um deles. Dizer "pronto" ali seria dar por classificado um dia
 * cuja metade nao chegou.
 *
 * Conta que nunca teve lancamento nenhum fica de fora do calculo: uma poupanca
 * parada arrastaria a fronteira para o passado e pintaria a fita inteira de
 * cinza.
 */
export function fronteiraDeDados(
  contas: { id: string }[],
  ultimoDiaPorConta: Record<string, string>,
  hoje: string,
): string | null {
  const dias = contas
    .map((conta) => ultimoDiaPorConta[conta.id])
    .filter((dia): dia is string => Boolean(dia));

  if (dias.length === 0) return null;

  const menor = dias.reduce((a, b) => (a < b ? a : b));
  // Nunca alem de hoje: parcela futura ja foi cortada na consulta, mas o teto
  // vale como rede — nenhum dia futuro pode ser dado como recebido.
  return menor < hoje ? menor : hoje;
}

/**
 * @param pendentesPorDia Quantas despesas daquele dia ainda esperam categoria.
 */
export function situacaoDoDia(
  dia: string,
  fronteira: string | null,
  pendentesPorDia: Record<string, number>,
): SituacaoDoDia {
  // Sem fronteira nao ha lancamento nenhum no banco: nada foi recebido ainda.
  if (!fronteira || dia > fronteira) return "sem-dados";
  return (pendentesPorDia[dia] ?? 0) > 0 ? "pendente" : "pronto";
}
