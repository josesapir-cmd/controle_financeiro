import Link from "next/link";

/**
 * Navegacao entre as abas.
 *
 * Uma marcacao so para as duas formas: no desktop os rotulos ficam em linha no
 * cabecalho; no celular a mesma lista vira barra fixa no rodape, o padrao dos
 * apps de iOS — o polegar alcanca o rodape, nao o topo da tela. A diferenca
 * esta toda no CSS (ver `.abas` em globals.css), entao nao ha duas listas de
 * links para manter em sincronia nem salto de layout na hidratacao.
 *
 * A selecao de contas viaja junto nos links que a respeitam: trocar de aba nao
 * pode descartar o filtro que o usuario acabou de aplicar. Conexoes fica de
 * fora porque nao filtra por conta.
 */

export type Aba = "/" | "/dia" | "/contrapartes" | "/conexoes";

interface Item {
  href: Aba;
  rotulo: string;
  /** Se o filtro de contas deve ser preservado ao navegar para ca. */
  preservaContas: boolean;
  icone: React.ReactNode;
}

/* Icones traçados, 20px, herdando currentColor: acompanham o estado ativo sem
   precisar de uma segunda variante colorida. */
const traco = {
  width: 20,
  height: 20,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

const ITENS: Item[] = [
  {
    href: "/",
    rotulo: "Painel",
    preservaContas: true,
    icone: (
      <svg {...traco}>
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    ),
  },
  {
    href: "/dia",
    rotulo: "Dia",
    preservaContas: true,
    icone: (
      <svg {...traco}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
    ),
  },
  {
    href: "/contrapartes",
    rotulo: "Contrapartes",
    preservaContas: true,
    icone: (
      <svg {...traco}>
        <path d="M3 8h13l-3-3M21 16H8l3 3" />
      </svg>
    ),
  },
  {
    href: "/conexoes",
    rotulo: "Conexoes",
    preservaContas: false,
    icone: (
      <svg {...traco}>
        <path d="M9.5 14.5 5.9 18a3.6 3.6 0 1 1-5-5l3.4-3.4" />
        <path d="m14.5 9.5 3.6-3.5a3.6 3.6 0 1 1 5 5l-3.4 3.4" />
        <path d="m9 15 6-6" />
      </svg>
    ),
  },
];

export function Nav({ atual, contasQuery = "" }: { atual: Aba; contasQuery?: string }) {
  return (
    <nav className="abas" aria-label="Secoes">
      {/* Marca no topo da barra lateral. Fica na marcacao, e nao em `content:`
          de pseudo-elemento, para ser texto de verdade para quem le a tela. */}
      <span className="abas-marca">Controle Financeiro</span>

      {ITENS.map((item) => {
        const destino =
          item.preservaContas && contasQuery ? `${item.href}?${contasQuery}` : item.href;
        const ativa = item.href === atual;

        return (
          <Link
            key={item.href}
            href={destino}
            className={ativa ? "aba ativa" : "aba"}
            aria-current={ativa ? "page" : undefined}
          >
            <span className="aba-icone">{item.icone}</span>
            <span className="aba-rotulo">{item.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
