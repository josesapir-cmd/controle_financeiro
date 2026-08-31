import { NAO_IDENTIFICADA, normalizeName } from "./counterparties";

/**
 * Conciliacao de contrapartes que sao a mesma com nomes de tamanhos diferentes.
 *
 * O caso concreto: a tela do saldo compartilhado corta o nome do estabelecimento
 * ("HOTEL FAZENDA CASC"), e o mesmo gasto, quando chega pelo Open Finance, vem
 * inteiro ("HOTEL FAZENDA CASCATINHA LTDA"). Sao a mesma contraparte. Tratadas
 * como duas, partem o historico e a classificacao em dois — e a categoria
 * atribuida a uma nao vale para a outra.
 *
 * A comparacao mora aqui, na aplicacao, e nao no SQL, porque o fingerprint
 * gravado e um HMAC: o banco nao tem como saber que um nome e prefixo do outro.
 */

/** Contraparte vista nos dados do periodo, do jeito que a agregacao a conhece. */
export interface Candidata {
  key: string;
  name: string;
  /** Documento identifica com certeza; nome sozinho, nao. */
  hasDocument: boolean;
  count: number;
}

export interface Sugestao {
  /** Fingerprint do nome recortado. */
  de: string;
  /** Fingerprint do nome completo. */
  para: string;
  nomeDe: string;
  nomePara: string;
  /**
   * Segura o bastante para valer sem perguntar. Continua visivel e reversivel:
   * uniao errada mistura o gasto de dois lugares, e isso precisa ser desfazivel.
   */
  automatica: boolean;
  motivo: string;
}

/** Decisoes ja tomadas: destino, ou null para "sao diferentes mesmo". */
export type Decisoes = Record<string, string | null>;

/**
 * Prefixo minimo para arriscar uma uniao.
 *
 * Curto demais colide facil — "PADARIA" prefixa meia duzia de padarias
 * diferentes. Este piso vale para nome que apenas parece cortado; nome com
 * reticencias explicitas usa o piso menor abaixo, porque ali sabemos que ha
 * continuacao.
 */
const MINIMO_PREFIXO = 12;
const MINIMO_PREFIXO_MARCADO = 8;

/** Piso para aplicar sozinho, sem confirmacao. */
const MINIMO_AUTOMATICO = 12;

/** Remove a marca de corte que o proprio texto carrega. */
function semReticencias(nome: string): { texto: string; cortado: boolean } {
  const limpo = nome.replace(/(\.{2,}|…)\s*$/, "").trim();
  return { texto: limpo, cortado: limpo.length !== nome.trim().length };
}

function comparavel(nome: string): { texto: string; cortado: boolean } {
  const { texto, cortado } = semReticencias(nome ?? "");
  return { texto: normalizeName(texto), cortado };
}

function elegivel(candidata: Candidata): boolean {
  return Boolean(candidata.key) && candidata.key !== NAO_IDENTIFICADA && Boolean(candidata.name);
}

/**
 * Sugere unioes entre as contrapartes do periodo.
 *
 * A direcao e sempre do nome curto para o longo, e so a partir de quem nao tem
 * documento: contraparte identificada por CPF ou CNPJ ja esta ancorada, e
 * dobra-la num casamento de nome seria trocar uma identidade forte por uma
 * fraca.
 *
 * Prefixo que casa com mais de um nome completo nao vira uniao automatica: pode
 * ser qualquer um dos dois, e escolher no chute mistura o gasto de dois lugares.
 * Vira sugestao para o usuario decidir.
 */
export function sugerirConciliacoes(
  candidatas: Candidata[],
  decisoes: Decisoes = {},
): Sugestao[] {
  const validas = candidatas.filter(elegivel);
  const sugestoes: Sugestao[] = [];

  for (const curta of validas) {
    // Decisao registrada encerra o assunto, nos dois sentidos.
    if (curta.key in decisoes) continue;
    if (curta.hasDocument) continue;

    const { texto: prefixo, cortado } = comparavel(curta.name);
    const minimo = cortado ? MINIMO_PREFIXO_MARCADO : MINIMO_PREFIXO;
    if (prefixo.length < minimo) continue;

    const alvos = validas.filter((outra) => {
      if (outra.key === curta.key) return false;
      const { texto } = comparavel(outra.name);
      return texto.length > prefixo.length && texto.startsWith(prefixo);
    });

    if (alvos.length === 0) continue;

    // Entre varios, o mais completo primeiro: com documento, depois com mais
    // lancamentos. Isso so escolhe a ordem de exibicao — ambiguidade nunca vira
    // uniao automatica.
    const ordenados = [...alvos].sort((a, b) => {
      if (a.hasDocument !== b.hasDocument) return a.hasDocument ? -1 : 1;
      return b.count - a.count;
    });

    const alvo = ordenados[0];
    const ambigua = alvos.length > 1;
    const automatica = !ambigua && prefixo.length >= MINIMO_AUTOMATICO;

    sugestoes.push({
      de: curta.key,
      para: alvo.key,
      nomeDe: curta.name,
      nomePara: alvo.name,
      automatica,
      motivo: ambigua
        ? `"${curta.name}" e comeco de ${alvos.length} nomes diferentes`
        : cortado
          ? "nome cortado no print, continua no nome completo"
          : "nome e comeco exato do nome completo",
    });
  }

  return sugestoes;
}

/**
 * Mapa fingerprint → fingerprint efetivo, pronto para reescrever transacoes.
 *
 * Junta o que o usuario decidiu com o que foi sugerido automaticamente, com a
 * decisao dele por cima — inclusive a de manter separado.
 *
 * Cadeias sao resolvidas ate o fim (A→B→C vira A→C) com trava de ciclo: duas
 * decisoes que apontam uma para a outra nao podem travar a renderizacao da
 * pagina.
 */
export function mapaDeConciliacao(sugestoes: Sugestao[], decisoes: Decisoes = {}): Record<string, string> {
  const direto: Record<string, string> = {};

  for (const sugestao of sugestoes) {
    if (sugestao.automatica) direto[sugestao.de] = sugestao.para;
  }
  for (const [de, para] of Object.entries(decisoes)) {
    if (para) direto[de] = para;
    else delete direto[de];
  }

  const resolvido: Record<string, string> = {};
  for (const inicio of Object.keys(direto)) {
    const visitados = new Set([inicio]);
    let atual = direto[inicio];

    while (direto[atual] && !visitados.has(atual)) {
      visitados.add(atual);
      atual = direto[atual];
    }

    if (atual !== inicio) resolvido[inicio] = atual;
  }

  return resolvido;
}

/** Aplica o mapa a uma chave. Chave sem uniao volta como esta. */
export function chaveEfetiva(key: string, mapa: Record<string, string>): string {
  return mapa[key] ?? key;
}
