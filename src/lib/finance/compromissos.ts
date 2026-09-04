import type { ChamadaRow, CompromissoRow } from "@/lib/db/repository";

/**
 * Compromisso de capital em fundo: o que foi prometido contra o que ja foi
 * chamado.
 *
 * O numero que interessa nao e o que ja saiu — esse esta no extrato. E o que
 * ainda pode ser chamado sem aviso, porque e ele que exige caixa parado. Por
 * isso `aChamar` e o campo que a tela destaca, e nao `chamado`.
 */
export interface CompromissoComChamadas {
  id: string;
  nome: string;
  comprometido: number;
  /** Soma de todas as chamadas registradas, pagas ou nao. */
  chamado: number;
  /** Soma so das chamadas ja pagas. E o dinheiro que de fato esta no fundo. */
  liquidado: number;
  /** Chamado e ainda nao pago: obrigacao com data marcada. */
  aLiquidar: number;
  /** O que o gestor ainda pode pedir. Nunca negativo: ver `montarCarteira`. */
  aChamar: number;
  /**
   * Tudo o que ainda vai sair: o que nao foi chamado mais o que foi chamado e
   * nao liquidou.
   *
   * E o numero que decide quanto caixa deixar parado. Olhar so o "a chamar"
   * esquece a conta que ja chegou; olhar so o "a liquidar" esquece a que pode
   * chegar amanha.
   */
  aPagar: number;
  /** Quanto do compromisso ja foi chamado, de 0 a 1. */
  fatiaChamada: number;
  /**
   * Chamadas somam mais que o compromisso.
   *
   * Acontece de verdade — chamada de taxa acima do compromisso, ou um valor
   * digitado errado — e a tela precisa dizer, e nao esconder num `aChamar`
   * negativo que ninguem le como erro.
   */
  excedido: boolean;
  assinadoEm: string | null;
  nota: string | null;
  encerrado: boolean;
  /** Da mais antiga para a mais recente, com o acumulado ate cada uma. */
  chamadas: {
    id: string;
    data: string;
    valor: number;
    nota: string | null;
    liquidada: boolean;
    /** Soma desta chamada e de todas as anteriores. */
    acumulado: number;
  }[];
}

export interface CarteiraDeCompromissos {
  fundos: CompromissoComChamadas[];
  comprometido: number;
  chamado: number;
  liquidado: number;
  aLiquidar: number;
  aChamar: number;
  aPagar: number;
}

/**
 * Junta compromissos e chamadas numa carteira.
 *
 * Funcao pura, fora do acesso ao banco, porque e aqui que mora toda a
 * aritmetica que pode estar errada — e ela precisa ser testavel sem subir
 * Postgres.
 */
export function montarCarteira(
  compromissos: CompromissoRow[],
  chamadas: ChamadaRow[],
): CarteiraDeCompromissos {
  const porCompromisso = new Map<string, ChamadaRow[]>();
  for (const chamada of chamadas) {
    const lista = porCompromisso.get(chamada.commitmentId) ?? [];
    lista.push(chamada);
    porCompromisso.set(chamada.commitmentId, lista);
  }

  const fundos = compromissos.map((fundo) => {
    // Ordenadas aqui, e nao confiando na ordem que veio: o acumulado de cada
    // linha so faz sentido em ordem cronologica, e ele ficaria errado em
    // silencio se a consulta mudasse de ORDER BY um dia.
    const suas = [...(porCompromisso.get(fundo.id) ?? [])].sort((a, b) =>
      a.calledOn === b.calledOn ? a.id.localeCompare(b.id) : a.calledOn.localeCompare(b.calledOn),
    );
    const chamado = suas.reduce((soma, c) => soma + c.amount, 0);
    const liquidado = suas.reduce((soma, c) => soma + (c.liquidada ? c.amount : 0), 0);
    let corrente = 0;

    return {
      id: fundo.id,
      nome: fundo.name,
      comprometido: fundo.committed,
      chamado,
      liquidado,
      aLiquidar: chamado - liquidado,
      // Piso em zero: o que sobra para chamar nao pode ser negativo, e o
      // excesso vira aviso proprio em vez de um numero sem sentido.
      aChamar: Math.max(0, fundo.committed - chamado),
      aPagar: Math.max(0, fundo.committed - chamado) + (chamado - liquidado),
      fatiaChamada: fundo.committed > 0 ? Math.min(1, chamado / fundo.committed) : 0,
      excedido: chamado > fundo.committed,
      assinadoEm: fundo.signedOn,
      nota: fundo.note,
      encerrado: fundo.closed,
      chamadas: suas.map((c) => {
        corrente += c.amount;
        return {
          id: c.id,
          data: c.calledOn,
          valor: c.amount,
          nota: c.note,
          liquidada: c.liquidada,
          acumulado: corrente,
        };
      }),
    };
  });

  return {
    // Do maior compromisso para o menor: e a ordem da exposicao, e o fundo
    // grande e o que muda a conta de caixa.
    fundos: fundos.sort((a, b) =>
      b.comprometido === a.comprometido
        ? a.nome.localeCompare(b.nome, "pt-BR")
        : b.comprometido - a.comprometido,
    ),
    comprometido: fundos.reduce((s, f) => s + f.comprometido, 0),
    chamado: fundos.reduce((s, f) => s + f.chamado, 0),
    liquidado: fundos.reduce((s, f) => s + f.liquidado, 0),
    aLiquidar: fundos.reduce((s, f) => s + f.aLiquidar, 0),
    // Somado dos fundos, e nao `comprometido - chamado`: um fundo que estourou
    // o compromisso nao pode abater a exposicao dos outros.
    aChamar: fundos.reduce((s, f) => s + f.aChamar, 0),
    aPagar: fundos.reduce((s, f) => s + f.aPagar, 0),
  };
}
