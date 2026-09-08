import { dadosDoCartao } from "./cartao";
import type { Detail } from "./details";
import { normalizeName } from "./counterparties";

/**
 * Identidade da COMPRA por tras de uma parcela.
 *
 * Dez parcelas de uma compra chegam como dez lancamentos, um por fatura, e
 * hoje cada um pede classificacao. Mas a decisao e uma so: quem escolheu a
 * categoria em agosto ja disse o que a parcela de marco de 2027 e — e essa
 * parcela ja esta no banco, porque o cartao manda as futuras junto.
 *
 * Para herdar, as parcelas precisam se reconhecer como irmas. O que as liga:
 *
 * - `purchaseDate`, o instante da compra original, igual em todas;
 * - `totalInstallments`, que separa duas compras no mesmo segundo com prazos
 *   diferentes;
 * - o cartao, porque dois plasticos podem comprar ao mesmo tempo;
 * - a descricao normalizada, que fecha a porta para o resto.
 *
 * Uma chave menor seria mais simples e erraria de um jeito caro: juntar duas
 * compras diferentes faria a categoria de uma vazar para a outra.
 */
export function chaveDaCompra(
  details: Detail[] | undefined,
  descricao: string | null | undefined,
): string | null {
  const cartao = dadosDoCartao(details);

  // Sem parcelamento nao ha o que herdar: uma compra a vista se resolve
  // sozinha, no mes em que aconteceu.
  if (!cartao.totalDeParcelas || cartao.totalDeParcelas <= 1) return null;

  const compra = details?.find((d) => d.label === "Cartao · purchaseDate")?.value?.trim();
  if (!compra) return null;

  return [
    cartao.numero ?? "",
    compra,
    String(cartao.totalDeParcelas),
    normalizeName(descricao ?? ""),
  ].join("|");
}

/** Se este lancamento e uma parcela de uma compra parcelada. */
export function ehParcelado(
  details: Detail[] | undefined,
  descricao: string | null | undefined,
): boolean {
  return chaveDaCompra(details, descricao) !== null;
}
