import { termosDaLoja } from "@/lib/importacao/pedidos";
import { normalizeName } from "./counterparties";

/**
 * Pedido lido de print que PODE ser esta despesa, mesmo sem ligacao gravada.
 *
 * Quando o print de pedidos e conferido, o produto se gruda na cobranca e vira
 * `transaction_products`. Mas o print pode estar lido e ainda nao conferido, ou
 * ter ficado ambiguo — e nesse caso a informacao existe no banco e nao chega a
 * quem esta classificando, que e exatamente quem precisa dela.
 *
 * Isto e PALPITE e a tela diz que e: mesma loja, mesmo valor, data proxima. A
 * regra e a mesma que o conferidor usa, so que sem gravar nada. Confundir as
 * duas coisas seria pior que nao mostrar — um produto errado ao lado da
 * despesa faz classificar com confianca no lugar errado.
 */

/** A cobranca do cartao raramente cai no dia do pedido: a loja cobra no envio. */
const DIAS_ANTES = 2;
const DIAS_DEPOIS = 10;
const TOLERANCIA = 0.005;

export interface PedidoLido {
  loja: string;
  produto: string;
  dia: string;
  valor: number;
  referencia: string | null;
}

export interface DespesaParaCasar {
  dia: string;
  /** Negativo para saida, como vem do extrato. */
  valor: number;
  descricao: string;
  contraparte?: string | null;
}

function distanciaEmDias(de: string, ate: string): number {
  return Math.round((Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000);
}

function daLoja(despesa: DespesaParaCasar, loja: string): boolean {
  const termos = termosDaLoja(loja);
  if (termos.length === 0) return false;

  const alvo = normalizeName(`${despesa.descricao} ${despesa.contraparte ?? ""}`);
  return termos.some((termo) => alvo.includes(normalizeName(termo)));
}

/**
 * Os pedidos que poderiam ser esta despesa, do mais proximo em dias ao mais
 * distante.
 *
 * Devolve TODOS os plausiveis, e nao o melhor: com dois candidatos, escolher um
 * seria decidir uma ambiguidade que a tela de conferencia existe para resolver.
 * Aqui a lista e informativa, e ver dois e a propria informacao.
 */
export function pedidosPlausiveis(
  despesa: DespesaParaCasar,
  pedidos: PedidoLido[],
): PedidoLido[] {
  if (despesa.valor >= 0) return [];

  return pedidos
    .filter((pedido) => {
      if (Math.abs(Math.abs(despesa.valor) - pedido.valor) > TOLERANCIA) return false;

      const dias = distanciaEmDias(pedido.dia, despesa.dia);
      if (dias < -DIAS_ANTES || dias > DIAS_DEPOIS) return false;

      return daLoja(despesa, pedido.loja);
    })
    .sort(
      (a, b) =>
        Math.abs(distanciaEmDias(a.dia, despesa.dia)) -
        Math.abs(distanciaEmDias(b.dia, despesa.dia)),
    );
}
