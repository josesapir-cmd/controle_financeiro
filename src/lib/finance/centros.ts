import { normalizeName, type CounterpartyTotal } from "./counterparties";

/**
 * Centros de custo.
 *
 * A categoria responde "em que tipo de coisa eu gasto"; o centro de custo
 * responde "em qual coisa especifica" — esta viagem, esta obra, esta pessoa.
 * Sao perguntas diferentes, e a segunda so fica util se o centro existir como
 * registro proprio: com orcamento, com periodo, e visivel mesmo antes do
 * primeiro gasto.
 *
 * Este modulo cruza a taxonomia com os totais reais. E puro: recebe as duas
 * listas e devolve os numeros, sem tocar em banco.
 */

export interface Categoria {
  id: string;
  name: string;
  kind: "despesa" | "receita" | "movimentacao";
  position: number;
}

export interface CentroDeCusto {
  id: string;
  categoryId: string;
  name: string;
  note: string | null;
  startsOn: string | null;
  endsOn: string | null;
  budget: number | null;
}

export interface CentroTotal extends CentroDeCusto {
  /** Saida total, positiva. */
  sent: number;
  received: number;
  /** Numero de lancamentos. */
  count: number;
  /** Quantas contrapartes distintas apontam para este centro. */
  counterparties: number;
  /** Fracao do orcamento ja consumida, quando ha orcamento. */
  budgetUsed?: number;
}

export interface CategoriaTotal extends Categoria {
  sent: number;
  received: number;
  count: number;
  counterparties: number;
  centros: CentroTotal[];
  /**
   * Gasto que caiu na categoria sem centro de custo. Aparece separado porque e
   * trabalho pendente: dinheiro classificado pela metade.
   */
  semCentro: { sent: number; received: number; count: number; counterparties: number };
}

/** Comparacao de rotulo: sem acento, sem caixa, sem espaco duplo. */
function chave(nome: string | null | undefined): string {
  return normalizeName(nome);
}

function vazio() {
  return { sent: 0, received: 0, count: 0, counterparties: 0 };
}

export interface Resultado {
  categorias: CategoriaTotal[];
  /** Contrapartes ainda sem categoria: o que falta classificar. */
  semCategoria: { sent: number; received: number; count: number; counterparties: number };
}

/**
 * Cruza taxonomia e movimento.
 *
 * A taxonomia manda: categoria e centro sem nenhum gasto no periodo aparecem
 * zerados, em vez de sumir. Um centro de custo criado para a viagem do mes que
 * vem precisa existir na tela antes de ter a primeira despesa — e um orcamento
 * que so aparece depois do primeiro gasto nao serve para planejar.
 */
export function cruzarCentrosDeCusto(
  categorias: Categoria[],
  centros: CentroDeCusto[],
  contrapartes: CounterpartyTotal[],
): Resultado {
  const porCategoria = new Map<string, CategoriaTotal>();
  const porNomeDeCategoria = new Map<string, CategoriaTotal>();

  for (const categoria of categorias) {
    const total: CategoriaTotal = {
      ...categoria,
      ...vazio(),
      centros: [],
      semCentro: vazio(),
    };
    porCategoria.set(categoria.id, total);
    porNomeDeCategoria.set(chave(categoria.name), total);
  }

  // Indice de centros por (categoria, nome), que e como a contraparte os
  // referencia hoje — pelo texto que o usuario digitou.
  const porNomeDeCentro = new Map<string, CentroTotal>();
  for (const centro of centros) {
    const categoria = porCategoria.get(centro.categoryId);
    if (!categoria) continue;

    const total: CentroTotal = { ...centro, ...vazio() };
    categoria.centros.push(total);
    porNomeDeCentro.set(`${centro.categoryId}|${chave(centro.name)}`, total);
  }

  const semCategoria = vazio();

  for (const c of contrapartes) {
    // Transferencia entre contas proprias nao e gasto de ninguem.
    if (c.self) continue;

    const categoria = c.category ? porNomeDeCategoria.get(chave(c.category)) : undefined;
    if (!categoria) {
      semCategoria.sent += c.sent;
      semCategoria.received += c.received;
      semCategoria.count += c.count;
      semCategoria.counterparties += 1;
      continue;
    }

    categoria.sent += c.sent;
    categoria.received += c.received;
    categoria.count += c.count;
    categoria.counterparties += 1;

    const centro = c.subcategory
      ? porNomeDeCentro.get(`${categoria.id}|${chave(c.subcategory)}`)
      : undefined;

    const alvo = centro ?? categoria.semCentro;
    alvo.sent += c.sent;
    alvo.received += c.received;
    alvo.count += c.count;
    alvo.counterparties += 1;
  }

  for (const categoria of porCategoria.values()) {
    for (const centro of categoria.centros) {
      if (centro.budget && centro.budget > 0) {
        centro.budgetUsed = centro.sent / centro.budget;
      }
    }
    // Movimento primeiro; entre os zerados, ordem alfabetica — assim um centro
    // recem-criado nao se perde no fim de uma lista longa.
    categoria.centros.sort((a, b) => {
      const movimento = b.sent + b.received - (a.sent + a.received);
      return movimento !== 0 ? movimento : a.name.localeCompare(b.name, "pt-BR");
    });
  }

  const ordenadas = [...porCategoria.values()].sort((a, b) => {
    if (a.position !== b.position) return a.position - b.position;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return { categorias: ordenadas, semCategoria };
}

/** Total gasto por tipo de categoria, para os numeros do topo da tela. */
export function totalPorTipo(
  categorias: CategoriaTotal[],
  kind: Categoria["kind"],
): { sent: number; received: number } {
  return categorias
    .filter((c) => c.kind === kind)
    .reduce(
      (total, c) => ({ sent: total.sent + c.sent, received: total.received + c.received }),
      { sent: 0, received: 0 },
    );
}
