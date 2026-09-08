import type { Detail } from "./details";

/**
 * O que o lancamento de cartao carrega alem do valor.
 *
 * A Pluggy manda um bloco `creditCardMetadata` que o `extractDetails` preserva
 * inteiro, como `Cartao · <campo>`. Ate aqui ele so era exibido; estes campos
 * sao os que valem decisao:
 *
 * - `numero`: os ultimos digitos do plastico. Numa fatura com adicionais, e a
 *   unica coisa que separa o gasto de uma pessoa do de outra — o banco nao
 *   manda nome nenhum.
 * - `mcc`: o codigo de ramo do estabelecimento (ISO 18245). Um classificador
 *   que a bandeira ja preencheu.
 * - `parcela` e `totalDeParcelas`: "3 de 10". Sem eles, dez parcelas parecem
 *   dez compras.
 */
export interface DadosDoCartao {
  numero: string | null;
  mcc: string | null;
  parcela: number | null;
  totalDeParcelas: number | null;
}

const PREFIXO = "Cartao · ";

/** O valor cru de um campo do bloco do cartao. */
function campo(details: Detail[] | undefined, nome: string): string | null {
  const alvo = `${PREFIXO}${nome}`;
  const achado = details?.find((d) => d.label === alvo);
  const valor = achado?.value?.trim();
  return valor ? valor : null;
}

function inteiro(valor: string | null): number | null {
  if (valor === null) return null;
  const numero = Number(valor);
  return Number.isInteger(numero) && numero > 0 ? numero : null;
}

export function dadosDoCartao(details: Detail[] | undefined): DadosDoCartao {
  return {
    numero: campo(details, "cardNumber"),
    mcc: campo(details, "payeeMCC"),
    parcela: inteiro(campo(details, "installmentNumber")),
    totalDeParcelas: inteiro(campo(details, "totalInstallments")),
  };
}

/**
 * "3/10", ou null quando o lancamento nao e parcelado.
 *
 * Uma parcela de uma so nao e parcelamento: o banco marca 1/1 em compra a
 * vista, e escrever isso na tela seria ruido em quase todo lancamento.
 */
export function rotuloDaParcela(dados: DadosDoCartao): string | null {
  if (!dados.parcela || !dados.totalDeParcelas || dados.totalDeParcelas <= 1) return null;
  return `${dados.parcela}/${dados.totalDeParcelas}`;
}
