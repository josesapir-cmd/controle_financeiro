/**
 * A divisao de uma despesa em partes.
 *
 * Paguei o almoco de seis e o hotel de tres casais: uma cobranca no extrato,
 * varias coisas por dentro. Uma parte e consumo meu, a outra e dinheiro que
 * volta. Somar tudo como gasto inventa despesa; chamar tudo de emprestimo
 * apaga o almoco que eu comi.
 *
 * A regra que este modulo existe para garantir e uma so: AS PARTES SOMAM O
 * TOTAL. Uma divisao que nao fecha e pior que nenhuma — ela some com dinheiro
 * sem avisar, e o erro aparece semanas depois como um total que ninguem
 * consegue explicar.
 */

export interface ParteDoRateio {
  /** Sempre positivo: e um pedaco do valor, o sinal ja esta na cobranca. */
  valor: number;
  categoriaId: string | null;
  centroId: string | null;
  /** Nome de quem deve, quando a parte e reembolso. */
  devedor: string | null;
}

export type ErroDoRateio =
  | { tipo: "sem-partes" }
  | { tipo: "valor-invalido" }
  | { tipo: "nao-fecha"; soma: number; total: number; diferenca: number };

export type Rateio =
  | { valido: true; partes: ParteDoRateio[] }
  | { valido: false; erro: ErroDoRateio };

/**
 * Centavos, e nao reais.
 *
 * Somar 33,33 tres vezes da 99,99, e recusar isso obrigaria a pessoa a caçar um
 * centavo. Um centavo de folga e o suficiente para aceitar a divisao honesta e
 * ainda recusar a distraida.
 */
const TOLERANCIA = 0.01;

/**
 * Arredonda para centavos, tirando o lixo de ponto flutuante.
 *
 * O epsilon nao e superstição: `1.005 * 100` da 100.49999999999999 em ponto
 * flutuante, e `Math.round` sozinho arredondaria meio centavo para BAIXO — o
 * contrario do que a funcao promete. Somar o menor incremento representavel
 * antes de arredondar corrige o caso da fronteira sem mexer nos outros.
 */
export function emCentavos(valor: number): number {
  const sinal = valor < 0 ? -1 : 1;
  return (sinal * Math.round((Math.abs(valor) + Number.EPSILON) * 100)) / 100;
}

export function validarRateio(total: number, partes: ParteDoRateio[]): Rateio {
  const alvo = emCentavos(Math.abs(total));

  const limpas = partes
    .map((parte) => ({ ...parte, valor: emCentavos(parte.valor) }))
    .filter((parte) => parte.valor > 0);

  if (limpas.length === 0) return { valido: false, erro: { tipo: "sem-partes" } };

  if (limpas.some((parte) => !Number.isFinite(parte.valor))) {
    return { valido: false, erro: { tipo: "valor-invalido" } };
  }

  const soma = emCentavos(limpas.reduce((total, parte) => total + parte.valor, 0));
  const diferenca = emCentavos(soma - alvo);

  if (Math.abs(diferenca) > TOLERANCIA) {
    return { valido: false, erro: { tipo: "nao-fecha", soma, total: alvo, diferenca } };
  }

  return { valido: true, partes: limpas };
}

/**
 * A parte que sobra, dado o que ja foi preenchido.
 *
 * A tela pergunta um valor e deduz o outro. Digitar os dois seria pedir que a
 * pessoa faca a conta que o computador ja sabe fazer — e abrir espaco para ela
 * errar.
 */
export function restante(total: number, jaInformado: number): number {
  return emCentavos(Math.max(0, emCentavos(Math.abs(total)) - emCentavos(jaInformado)));
}

export function descreverErro(erro: ErroDoRateio): string {
  switch (erro.tipo) {
    case "sem-partes":
      return "Informe ao menos um valor.";
    case "valor-invalido":
      return "Valor invalido.";
    case "nao-fecha":
      return erro.diferenca > 0
        ? `As partes somam ${erro.diferenca.toFixed(2)} a mais que a despesa.`
        : `Faltam ${Math.abs(erro.diferenca).toFixed(2)} para fechar a despesa.`;
  }
}
