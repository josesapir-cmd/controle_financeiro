export interface ColunasDoInforme {
  cnpj: number;
  data: number;
  cota: number;
}

export interface PontoDeCota {
  cnpj: string | null;
  dia: string;
  cota: number;
}

export interface CotaEncontrada extends PontoDeCota {
  /** Quantos dias antes da data pedida esta cotacao e. */
  atraso: number;
}

export interface AporteSimulado {
  cotas: number;
  valor: number;
  entrada: CotaEncontrada;
  saida: CotaEncontrada;
  dias: number;
}

export function soDigitos(valor: unknown): string;
export function colunasDoInformeDiario(linha: string): ColunasDoInforme | null;
export function lerLinhaDoInformeDiario(
  indices: ColunasDoInforme,
  linha: string,
): PontoDeCota | null;
export function lerInformeDeFluxo(
  fluxo: NodeJS.ReadableStream,
  cnpj: string,
  criarInterface: (fluxo: NodeJS.ReadableStream) => AsyncIterable<string>,
): Promise<PontoDeCota[]>;
export function lerSeriesJson(texto: string | object): Map<string, PontoDeCota[]>;
export function lerSerieSolta(texto: string): PontoDeCota[];
export function cotaEm(serie: PontoDeCota[], dia: string): CotaEncontrada | null;
export function mesesNecessarios(datas: (string | null | undefined)[]): string[];
export function simularAporte(
  lote: { aportado: number; compradoEm: string },
  serie: PontoDeCota[],
  diaFinal: string,
): AporteSimulado | null;
export function aoAno(inicial: number, final: number, dias: number): number | null;
export function impostoDeFia(aportado: number, valor: number): number;
