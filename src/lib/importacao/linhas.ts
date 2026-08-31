import { fingerprint } from "@/lib/crypto";

/**
 * Normalizacao e mesclagem das linhas lidas de prints do saldo compartilhado.
 *
 * Separada da chamada ao modelo de proposito: e a parte que decide o que vira
 * lancamento — sinal, data, identidade, e o que e suspeita de duplicata — e
 * precisa ser testavel sem rede.
 *
 * As imagens sobem em fila, alguns arquivos por envio. Dentro de um envio o
 * proprio modelo enxerga as telas juntas e nao repete a linha que aparece em
 * duas que se sobrepoem. Entre envios ele nao tem como saber, e e aqui que a
 * repeticao e detectada.
 */

/** Linha como o modelo devolve, ainda sem validar. */
export interface LinhaBruta {
  data?: unknown;
  descricao?: unknown;
  valor?: unknown;
  tipo?: unknown;
  confianca?: unknown;
}

export type Confianca = "alta" | "media" | "baixa";

export interface Linha {
  /** Identidade estavel, ver `identidade()`. */
  id: string;
  /** AAAA-MM-DD no fuso local. */
  dia: string;
  descricao: string;
  /** Ja com o sinal do app: negativo e dinheiro saindo. */
  valor: number;
  confianca: Confianca;
  /** N-esima linha identica dentro deste lote. Entra na identidade. */
  ocorrencia: number;
  /** Numero do envio da fila que trouxe esta linha, comecando em 1. */
  envio: number;
  /** Arquivos daquele envio, para o usuario localizar a linha no print. */
  arquivos: string[];
  /**
   * Ha linha igual (mesmo dia, valor e descricao) vinda de OUTRO envio. Pode ser
   * a mesma despesa fotografada duas vezes ou duas despesas iguais de verdade —
   * so quem viu as telas sabe, entao a tela de conferencia pergunta.
   */
  duplicada: boolean;
}

export interface LinhaRejeitada {
  motivo: string;
  original: LinhaBruta;
}

/** Linha ja validada, antes de receber lugar no lote. */
type LinhaValidada = Omit<Linha, "id" | "ocorrencia" | "duplicada">;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function confianca(valor: unknown): Confianca {
  return valor === "alta" || valor === "media" || valor === "baixa" ? valor : "baixa";
}

/** Espacos colapsados, sem acento e em minuscula — so para comparar, nunca para exibir. */
export function chaveDeComparacao(descricao: string): string {
  return descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Dia + valor + contraparte: o que define "a mesma despesa" para o usuario. */
export function chaveDaDespesa(dia: string, valor: number, descricao: string): string {
  return `${dia}|${Math.abs(valor).toFixed(2)}|${chaveDeComparacao(descricao)}`;
}

/**
 * Identidade de uma despesa lida de print.
 *
 * Deterministica em (dia, valor, descricao, n-esima ocorrencia identica) para
 * que reenviar o mesmo print atualize em vez de duplicar — o usuario vai subir
 * telas que se sobrepoem, e cada sobreposicao nao pode virar gasto novo.
 *
 * A ocorrencia entra na chave porque o print nao traz horario: duas corridas de
 * R$ 20 no mesmo dia sao dois gastos, e sem o indice a segunda sumiria dentro
 * da primeira.
 */
export function identidade(
  dia: string,
  valor: number,
  descricao: string,
  ocorrencia: number,
): string {
  return `print:${fingerprint("shared-expense", `${chaveDaDespesa(dia, valor, descricao)}|${ocorrencia}`)}`;
}

export interface Validacao {
  linhas: LinhaValidada[];
  rejeitadas: LinhaRejeitada[];
}

export interface Procedencia {
  envio: number;
  arquivos: string[];
}

/**
 * Valida o que o modelo devolveu de um envio.
 *
 * Entrada duvidosa nao vira lancamento silencioso: o que nao passa sai em
 * `rejeitadas` com o motivo, para a tela mostrar em vez de engolir.
 */
export function validar(brutas: LinhaBruta[], procedencia: Procedencia): Validacao {
  const linhas: LinhaValidada[] = [];
  const rejeitadas: LinhaRejeitada[] = [];

  for (const bruta of brutas) {
    const dia = texto(bruta.data);
    const descricao = texto(bruta.descricao);
    const valorBruto = typeof bruta.valor === "number" ? bruta.valor : Number(bruta.valor);

    if (!DIA.test(dia)) {
      rejeitadas.push({ motivo: "Data ilegivel", original: bruta });
      continue;
    }
    if (!descricao) {
      rejeitadas.push({ motivo: "Sem descricao", original: bruta });
      continue;
    }
    if (!Number.isFinite(valorBruto) || valorBruto === 0) {
      rejeitadas.push({ motivo: "Valor ilegivel", original: bruta });
      continue;
    }

    // O modelo devolve o valor sempre positivo e o sentido em `tipo`. Confiar no
    // sinal que ele escrever seria confiar duas vezes na mesma leitura.
    const magnitude = Math.abs(valorBruto);

    linhas.push({
      dia,
      descricao,
      valor: bruta.tipo === "entrada" ? magnitude : -magnitude,
      confianca: confianca(bruta.confianca),
      envio: procedencia.envio,
      arquivos: procedencia.arquivos,
    });
  }

  return { linhas, rejeitadas };
}

function ordenar(linhas: Linha[]): Linha[] {
  return [...linhas].sort((a, b) => {
    if (a.dia !== b.dia) return a.dia.localeCompare(b.dia);
    if (a.descricao !== b.descricao) return a.descricao.localeCompare(b.descricao, "pt-BR");
    return a.ocorrencia - b.ocorrencia;
  });
}

/**
 * Junta as linhas de um envio novo ao que o lote ja tinha.
 *
 * Nada e descartado: linha repetida entre envios entra marcada, nao sumida.
 * O motivo e que "mesmo dia, mesmo valor, mesma contraparte" tanto pode ser a
 * mesma compra fotografada duas vezes quanto dois cafes iguais na mesma
 * padaria — e apagar o segundo caso, silenciosamente, tira dinheiro do controle
 * sem ninguem perceber. Quem viu as telas decide.
 *
 * Repeticao dentro do MESMO envio nao e suspeita: ali o modelo viu as duas
 * imagens de uma vez e ja teria unido o que fosse a mesma linha.
 */
export function mesclar(existentes: Linha[], novas: LinhaValidada[]): Linha[] {
  const grupos = new Map<string, Linha[]>();
  for (const linha of existentes) {
    const chave = chaveDaDespesa(linha.dia, linha.valor, linha.descricao);
    grupos.set(chave, [...(grupos.get(chave) ?? []), linha]);
  }

  const resultado = [...existentes];

  for (const nova of novas) {
    const chave = chaveDaDespesa(nova.dia, nova.valor, nova.descricao);
    const grupo = grupos.get(chave) ?? [];
    const ocorrencia = grupo.length + 1;
    const duplicada = grupo.some((anterior) => anterior.envio !== nova.envio);

    const linha: Linha = {
      ...nova,
      id: identidade(nova.dia, nova.valor, nova.descricao, ocorrencia),
      ocorrencia,
      duplicada,
    };

    grupos.set(chave, [...grupo, linha]);
    resultado.push(linha);
  }

  return ordenar(resultado);
}

/** Soma das saidas, como numero positivo. */
export function totalDeSaidas(linhas: Linha[]): number {
  return linhas.reduce((total, linha) => (linha.valor < 0 ? total - linha.valor : total), 0);
}

/** Quantas linhas o usuario ainda precisa decidir se sao repeticao. */
export function suspeitasDeDuplicata(linhas: Linha[]): Linha[] {
  return linhas.filter((linha) => linha.duplicada);
}

/**
 * Reconstroi uma linha a partir do que a tela de conferencia devolveu.
 *
 * O usuario pode ter corrigido data, descricao e valor — a identidade e
 * recalculada sobre o corrigido, que e o que vira lancamento. A ocorrencia vem
 * junto do formulario, ja fixada na leitura: reconta-la aqui mudaria o id de
 * uma linha so porque a linha identica ao lado foi desmarcada.
 *
 * Devolve null para entrada que nao passa na validacao, para que uma correcao
 * malfeita nao vire lancamento silencioso.
 */
export function doFormulario(campos: {
  dia: string;
  descricao: string;
  valor: number;
  tipo: string;
  confianca: string;
  ocorrencia: number;
}): Linha | null {
  const { linhas } = validar(
    [
      {
        data: campos.dia,
        descricao: campos.descricao,
        valor: campos.valor,
        tipo: campos.tipo,
        confianca: campos.confianca,
      },
    ],
    { envio: 0, arquivos: [] },
  );

  const [validada] = linhas;
  if (!validada) return null;

  const ocorrencia = Number.isFinite(campos.ocorrencia) && campos.ocorrencia > 0
    ? Math.trunc(campos.ocorrencia)
    : 1;

  return {
    ...validada,
    id: identidade(validada.dia, validada.valor, validada.descricao, ocorrencia),
    ocorrencia,
    duplicada: false,
  };
}

/**
 * Reparte as linhas pelo trabalho que cada uma exige de quem confere.
 *
 * A tela de conferencia e ordenada por isto, nao pela ordem de leitura: linha
 * que exige decisao no topo, linha duvidosa em seguida, e o resto somado em
 * bloco fechado. Misturar as tres afoga as poucas que importam no meio das
 * muitas que nao pedem nada.
 *
 * A regra e a mesma em qualquer lugar que conte esses grupos — tela de
 * conferencia, lista de importacoes, avisos —, entao mora aqui.
 */
export function classificarParaConferencia<T extends { duplicada: boolean; confianca: string }>(
  linhas: T[],
): { decidir: T[]; conferir: T[]; prontas: T[] } {
  return {
    // Repetida entre envios: so quem viu as telas sabe se e a mesma compra
    // fotografada duas vezes ou duas compras iguais de verdade.
    decidir: linhas.filter((l) => l.duplicada),
    // Lida sem confianca alta: entra, mas vale bater contra o print.
    conferir: linhas.filter((l) => !l.duplicada && l.confianca !== "alta"),
    prontas: linhas.filter((l) => !l.duplicada && l.confianca === "alta"),
  };
}
