/**
 * Quem manda quando mais de uma regra alcanca o mesmo lancamento.
 *
 * Quatro coisas podem classificar uma despesa, e elas se sobrepoem:
 *
 * 1. a decisao sobre AQUELE lancamento — arrastar o cartao, jogar, editar;
 * 2. a decisao sobre a COMPRA, quando o lancamento e uma parcela dela;
 * 3. a regra do CARTAO — "tudo o que sai do cartao do meu pai e transferencia";
 * 4. a heranca da CONTRAPARTE — "todo pagamento ao mercado X e alimentacao".
 *
 * A ordem e essa, do mais especifico para o mais geral. A decisao individual
 * vence porque foi tomada olhando aquele gasto. A da compra vem logo depois
 * porque tambem foi uma decisao, so que tomada na primeira parcela: dez
 * parcelas sao um gasto, nao dez. E a regra do cartao vence a da contraparte
 * porque fala de origem, e origem nao muda — uma compra de supermercado no
 * cartao do pai continua sendo gasto do pai, por mais que a contraparte diga
 * alimentacao.
 *
 * Isto vive num modulo proprio, e nao repetido em cada tela, porque ja houve o
 * caso de duas telas discordarem — a bolinha da fita dizia "dia pronto" e a
 * lista do dia mostrava pendencias. Divergir aqui nao da erro, da duas
 * verdades.
 */

export interface Atribuicao {
  categoryId: string | null;
  costCenterId: string | null;
}

export type OrigemDaClassificacao = "proprio" | "compra" | "cartao" | "contraparte";

export interface Classificacao extends Atribuicao {
  /** `null` quando nada classificou o lancamento. */
  origem: OrigemDaClassificacao | null;
}

/** Uma atribuicao so conta se disser alguma coisa. */
function vale(atribuicao: Atribuicao | null | undefined): atribuicao is Atribuicao {
  return Boolean(atribuicao && (atribuicao.categoryId || atribuicao.costCenterId));
}

export function classificar(candidatos: {
  proprio?: Atribuicao | null;
  compra?: Atribuicao | null;
  cartao?: Atribuicao | null;
  contraparte?: Atribuicao | null;
}): Classificacao {
  const ordem: [OrigemDaClassificacao, Atribuicao | null | undefined][] = [
    ["proprio", candidatos.proprio],
    ["compra", candidatos.compra],
    ["cartao", candidatos.cartao],
    ["contraparte", candidatos.contraparte],
  ];

  for (const [origem, atribuicao] of ordem) {
    if (vale(atribuicao)) {
      return {
        categoryId: atribuicao.categoryId,
        costCenterId: atribuicao.costCenterId,
        origem,
      };
    }
  }

  return { categoryId: null, costCenterId: null, origem: null };
}

/** Se o lancamento ja tem categoria, venha ela de onde vier. */
export function estaClassificado(candidatos: {
  proprio?: Atribuicao | null;
  compra?: Atribuicao | null;
  cartao?: Atribuicao | null;
  contraparte?: Atribuicao | null;
}): boolean {
  return classificar(candidatos).origem !== null;
}
