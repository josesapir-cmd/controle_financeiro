import { normalizeName } from "@/lib/finance/counterparties";

/**
 * Icones de traco fino das categorias.
 *
 * Vieram do protótipo de design: viewBox 32, traco 1.1, curvas propositalmente
 * irregulares — desenhadas a mao, nao geometricas. Sao placeholder de estilo:
 * o handoff diz que nao sao arte final.
 *
 * So seis categorias tem desenho proprio. As outras dez usam a etiqueta
 * generica, que e honesto: inventar dez rabiscos ruins seria pior do que
 * repetir um neutro ate haver arte de verdade.
 */

const RABISCO: Record<string, string[]> = {
  casa: [
    "M5.5 15.2c3.4-3 6.9-6 10.4-8.9 3.6 2.9 7.1 5.9 10.5 8.9",
    "M8.2 14.1c-.2 3.6-.3 7.2-.2 10.8 5.4.4 10.8.4 16.2 0 .2-3.6.1-7.2-.1-10.8",
    "M13.4 24.7c-.1-2.3-.1-4.6 0-6.9 1.8-.2 3.6-.2 5.4 0 .1 2.3.1 4.6 0 6.9",
  ],
  folha: [
    "M4.6 10.3c7.6-.7 15.2-.8 22.8-.2.3 4 .3 8 0 12-7.6.6-15.2.5-22.8-.2-.3-3.9-.3-7.7 0-11.6",
    "M16 12.6c1.9.1 3.4 1.6 3.4 3.5s-1.5 3.4-3.4 3.4-3.4-1.6-3.4-3.5 1.5-3.4 3.4-3.4",
    "M8.2 13.1v5.9",
    "M23.8 13v6",
  ],
  viagem: [
    "M3.4 17.4c3.6-1.3 7.2-2.6 10.9-3.9-1-2.4-1.9-4.9-2.7-7.4.9-.3 1.9-.3 2.8-.1 1.9 2.1 3.7 4.2 5.5 6.4 2-.6 4.1-1.1 6.2-1.3 1.3-.1 2.3.6 2.4 1.6.1 1-.7 1.9-2 2.3-2 .6-4 1.3-6 2-1 2.7-2.1 5.3-3.3 7.9-.9.3-1.8.3-2.7 0-.3-2.6-.5-5.2-.6-7.8-3.5 1.2-7 2.4-10.5 3.5",
    "M4.7 15.8c-.5.9-.9 1.9-1.3 2.9",
  ],
  saude: [
    "M16 25.6C11.2 22.1 6.4 18.3 5.6 13.9c-.6-3.2 1.7-5.9 4.6-5.9 2.3 0 4.4 1.6 5.8 3.6 1.4-2 3.5-3.6 5.8-3.6 2.9 0 5.2 2.7 4.6 5.9-.8 4.4-5.6 8.2-10.4 11.7",
    "M9.6 15.9h3.1l1.7-3 2.4 5.6 1.6-2.6h3.9",
  ],
  familia: [
    "M11.6 13.6c2 0 3.5-1.7 3.5-3.7s-1.5-3.5-3.5-3.5-3.5 1.6-3.5 3.6 1.6 3.6 3.5 3.6",
    "M5.2 25.4c-.3-4 1.9-7.4 6.4-7.5 4.4-.1 6.7 3.3 6.5 7.4-4.3.4-8.6.4-12.9.1",
    "M21.4 12.4c1.6 0 2.8-1.3 2.8-2.9s-1.2-2.8-2.8-2.8",
    "M20.6 18.2c4-.4 6.6 2.4 6.4 6.9-1.6.2-3.2.3-4.8.3",
  ],
  compras: [
    "M7.4 11.6c5.8-.5 11.5-.5 17.3 0 .8 4.4 1.1 8.9.9 13.4-6.4.5-12.8.5-19.2 0-.2-4.5.2-9 1-13.4",
    "M11.8 13.6c-.3-3.4.9-6.1 4.2-6.2 3.3-.1 4.6 2.7 4.4 6.1",
  ],
  etiqueta: [
    "M6.2 6.4c4.1-.4 8.2-.5 12.3-.3 2.8 2.7 5.5 5.5 8.1 8.4-3.7 4-7.6 7.8-11.7 11.4-3-2.8-5.9-5.7-8.7-8.7-.3-3.6-.3-7.2 0-10.8",
    "M11.1 11.4c.9 0 1.6.8 1.6 1.7s-.7 1.6-1.6 1.6-1.7-.8-1.7-1.7.8-1.6 1.7-1.6",
  ],
};

/** Nome da categoria para o desenho, com recuo na etiqueta generica. */
const POR_NOME: [RegExp, string][] = [
  [/^CASA/, "casa"],
  [/FOLHA/, "folha"],
  [/VIAGEM|VIAGENS/, "viagem"],
  [/SAUDE/, "saude"],
  [/FAMILIA/, "familia"],
  [/COMPRAS|MANTIMENTOS|MERCADO/, "compras"],
];

export function desenhoDaCategoria(nome: string): string {
  const chave = normalizeName(nome);
  return POR_NOME.find(([padrao]) => padrao.test(chave))?.[1] ?? "etiqueta";
}

export function IconeDeCategoria({
  nome,
  tamanho = 30,
  animar = false,
}: {
  nome: string;
  tamanho?: number;
  /** O icone da categoria aberta se move devagar; os outros ficam parados. */
  animar?: boolean;
}) {
  const desenho = desenhoDaCategoria(nome);

  return (
    <svg
      width={tamanho}
      height={tamanho}
      viewBox="0 0 32 32"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={animar ? `rabisco rabisco-${desenho}` : "rabisco"}
    >
      {RABISCO[desenho].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
