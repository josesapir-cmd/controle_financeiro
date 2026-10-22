export interface FaixaDeIr {
  aliquota: number;
  /** Ultimo dia da faixa; nulo na de 15%. */
  ate: number | null;
}

export const FAIXAS_DE_IR: FaixaDeIr[];

/** Um movimento de investimento como a Pluggy manda. So os campos lidos. */
export interface MovimentoDeInvestimento {
  id?: string | null;
  type?: string | null;
  movementType?: string | null;
  quantity?: number | null;
  /** Preco unitario. */
  value?: number | null;
  amount?: number | null;
  netAmount?: number | null;
  date?: string | null;
  tradeDate?: string | null;
}

export interface Lote {
  /** ISO. */
  compradoEm: string;
  /** O que sobrou do lote depois das vendas passadas. */
  quantidade: number;
  /** O que o lote tinha quando entrou. */
  original: number;
  precoUnitario: number;
  /** "transferencia" quer dizer que a data e a da transferencia, nao a da compra. */
  origem: "compra" | "transferencia";
  id: string | null;
}

export interface Degrau {
  dia: string;
  aliquota: number;
}

export interface Pedaco extends Lote {
  quantidadeVendida: number;
  dias: number;
  bruto: number;
  custo: number;
  ganho: number;
  aliqIof: number;
  aliqIr: number;
  iof: number;
  ir: number;
  liquido: number;
  degrau: Degrau | null;
}

export interface Simulacao {
  em: string;
  preco: number;
  modo: "bruto" | "liquido";
  alvo: number;
  disponivel: number;
  quantidade: number;
  insuficiente: boolean;
  pedacos: Pedaco[];
  bruto: number;
  custo: number;
  ganho: number;
  iof: number;
  ir: number;
  liquido: number;
  prejuizo: number;
  irSeCompensar: number;
}

export interface Economia {
  compradoEm: string;
  dia: string;
  de: number;
  para: number;
  economia: number;
}

export function diasEntre(de: string, ate: string): number;
export function aliquotaDeIr(dias: number): number;
export function aliquotaDeIof(dias: number): number;
export function proximoDegrau(compradoEm: string, em: string): Degrau | null;
export function sentidoDoMovimento(
  m: MovimentoDeInvestimento,
): { sentido: "entra" | "sai"; origem: "compra" | "venda" | "transferencia" } | null;
export function lotesEmAberto(movimentos: MovimentoDeInvestimento[]): {
  lotes: Lote[];
  sobra: number;
  ignorados: number;
};
export function venderPedaco(lote: Lote, quantidade: number, preco: number, em: string): Pedaco;
export function simularVenda(
  lotes: Lote[],
  opcoes: { preco: number; em: string; alvo: number; modo?: "bruto" | "liquido" },
): Simulacao;
export function economiaEsperando(simulacao: Simulacao): Economia[];

export interface FilaDeVenda {
  /** Quem chama decide o que identifica a fila (id da posicao, por exemplo). */
  chave: string;
  lotes: Lote[];
  preco: number;
}

export interface PlanoCombinado {
  ordens: { chave: string; simulacao: Simulacao }[];
  bruto: number;
  ganho: number;
  ir: number;
  iof: number;
  liquido: number;
  insuficiente: boolean;
}

export function planoCombinado(
  filas: FilaDeVenda[],
  opcoes: { em: string; alvo: number; modo?: "bruto" | "liquido" },
): PlanoCombinado;
