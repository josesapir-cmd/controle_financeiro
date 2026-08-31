import { fingerprint } from "@/lib/crypto";

/**
 * Normalizacao das linhas lidas de um print do saldo compartilhado.
 *
 * Separada da chamada ao modelo de proposito: e a parte que decide o que vira
 * lancamento — sinal, data, identidade — e precisa ser testavel sem rede.
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
}

export interface LinhaRejeitada {
  motivo: string;
  original: LinhaBruta;
}

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

/**
 * Identidade de uma despesa lida de print.
 *
 * Deterministica em (dia, valor, descricao, n-esima ocorrencia identica) para
 * que reenviar o mesmo print atualize em vez de duplicar — o usuario vai subir
 * telas que se sobrepoem, e cada sobreposicao nao pode virar gasto novo.
 *
 * A ocorrencia entra na chave porque o print nao traz horario: duas corridas de
 * R$ 20 no mesmo dia sao dois gastos, e sem o indice a segunda sumiria dentro
 * da primeira. O preco e conhecido: um print que mostre so a segunda das duas a
 * trata como a primeira. Isso subconta, nunca duplica, e a tela de conferencia
 * existe para o usuario ver antes de gravar.
 */
export function identidade(dia: string, valor: number, descricao: string, ocorrencia: number): string {
  const chave = `${dia}|${valor.toFixed(2)}|${chaveDeComparacao(descricao)}|${ocorrencia}`;
  return `print:${fingerprint("shared-expense", chave)}`;
}

export interface Normalizacao {
  linhas: Linha[];
  rejeitadas: LinhaRejeitada[];
}

/**
 * Valida as linhas do modelo e atribui identidade.
 *
 * Entrada duvidosa nao vira lancamento silencioso: o que nao passa sai em
 * `rejeitadas` com o motivo, para a tela mostrar em vez de engolir.
 */
export function normalizar(brutas: LinhaBruta[]): Normalizacao {
  const linhas: Linha[] = [];
  const rejeitadas: LinhaRejeitada[] = [];
  const vistas = new Map<string, number>();

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
    const valor = bruta.tipo === "entrada" ? magnitude : -magnitude;

    const grupo = `${dia}|${magnitude.toFixed(2)}|${chaveDeComparacao(descricao)}`;
    const ocorrencia = (vistas.get(grupo) ?? 0) + 1;
    vistas.set(grupo, ocorrencia);

    linhas.push({
      id: identidade(dia, magnitude, descricao, ocorrencia),
      dia,
      descricao,
      valor,
      confianca: confianca(bruta.confianca),
    });
  }

  linhas.sort((a, b) => (a.dia === b.dia ? a.descricao.localeCompare(b.descricao, "pt-BR") : a.dia.localeCompare(b.dia)));
  return { linhas, rejeitadas };
}

/** Soma das saidas, como numero positivo. */
export function totalDeSaidas(linhas: Linha[]): number {
  return linhas.reduce((total, linha) => (linha.valor < 0 ? total - linha.valor : total), 0);
}
