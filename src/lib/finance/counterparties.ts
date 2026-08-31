import { translateCategory } from "./categories";
import type { Detail } from "./details";

/**
 * Extracao e agregacao de contrapartes.
 *
 * A Pluggy entrega os dados da contraparte no bloco paymentData de cada
 * transacao. Esse bloco tambem carrega o CPF do proprio usuario, entao a
 * extracao acontece na fronteira do servico (ver sanitize em service.ts): o que
 * segue adiante e so o minimo que esta funcionalidade exige.
 *
 * Forma verificada contra dados reais (conector Inter):
 *
 * - Pix enviado: receiver vem completo, com nome. payer traz o documento do
 *   proprio usuario e nome nulo.
 * - Pix recebido: payer traz o documento e, as vezes, o nome. receiver e o
 *   proprio usuario.
 * - Transferencia recebida: payer vem nulo por inteiro — a contraparte nao e
 *   recuperavel, e o app precisa dizer isso em vez de inventar.
 * - Aplicacao/investimento: receiver nulo, sem contraparte.
 */

export interface PaymentParticipant {
  name?: string | null;
  documentNumber?: { type?: string | null; value?: string | null } | null;
}

export interface PaymentData {
  payer?: PaymentParticipant | null;
  receiver?: PaymentParticipant | null;
  paymentMethod?: string | null;
}

export interface Counterparty {
  /** Identidade estavel: digitos do documento, ou nome normalizado. */
  key: string;
  name?: string;
  document?: string;
  documentType?: string;
  /** Transferencia entre contas do proprio usuario. */
  self: boolean;
}

export const NAO_IDENTIFICADA = "__nao_identificada__";

function digits(value: string | null | undefined): string {
  return (value ?? "").replace(/\D/g, "");
}

/** Nome sem acento, caixa ou espaco duplo — para servir de chave de recuo. */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Muitas descricoes trazem o nome depois de um hifen ("Pix enviado - FULANO"),
 * o que salva os casos em que paymentData vem sem nome.
 */
export function nameFromDescription(description: string | null | undefined): string | undefined {
  const texto = (description ?? "").trim();
  const separador = texto.indexOf(" - ");
  if (separador === -1) return undefined;

  const candidato = texto.slice(separador + 3).trim();
  return candidato.length > 1 ? candidato : undefined;
}

export function maskDocument(document: string | undefined, type?: string): string {
  const d = digits(document);
  if (!d) return "";
  if (d.length === 11) return `•••.•••.${d.slice(6, 9)}-${d.slice(9)}`;
  if (d.length === 14) return `••.•••.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  return type ? `${type} ••${d.slice(-3)}` : `••${d.slice(-3)}`;
}

/**
 * Identifica a contraparte de uma transacao.
 *
 * A direcao decide qual lado olhar: numa saida a contraparte e quem recebeu;
 * numa entrada, quem pagou. O outro lado e o proprio usuario, e serve para
 * detectar transferencia entre contas proprias sem exigir cadastro.
 */
export function extractCounterparty(
  paymentData: PaymentData | null | undefined,
  amount: number,
  description?: string | null,
): Counterparty | null {
  const saida = amount < 0;
  const outro = saida ? paymentData?.receiver : paymentData?.payer;
  const proprio = saida ? paymentData?.payer : paymentData?.receiver;

  const documento = digits(outro?.documentNumber?.value);
  const documentoProprio = digits(proprio?.documentNumber?.value);
  const nome = outro?.name?.trim() || nameFromDescription(description);

  if (!documento && !nome) {
    // Sem documento e sem nome nao ha o que identificar. Acontece nas
    // transferencias recebidas em que payer vem nulo.
    return paymentData ? { key: NAO_IDENTIFICADA, self: false } : null;
  }

  const self = Boolean(documento && documentoProprio && documento === documentoProprio);

  return {
    key: documento || normalizeName(nome),
    name: nome || undefined,
    document: documento || undefined,
    documentType: outro?.documentNumber?.type ?? undefined,
    self,
  };
}

/**
 * Classificacao atribuida pelo usuario a uma contraparte, em dois niveis.
 *
 * A hierarquia existe porque uma categoria sozinha e grossa demais: "Viagem"
 * junta a viagem de trabalho com o fim de semana em familia. A subcategoria
 * separa ocasioes dentro do mesmo tipo de gasto — Viagem > Viagem FDS Familia >
 * Hotel Fazenda Cascatinha.
 */
export interface CounterpartyEntryRegistry {
  category?: string;
  subcategory?: string;
  /** Abreviacao usada para falar da contraparte. */
  alias?: string;
  /** Nome oficial fixado pelo usuario, quando o do extrato nao serve. */
  officialName?: string;
}

export interface CounterpartyRegistry {
  [key: string]: CounterpartyEntryRegistry;
}

export interface CounterpartyTotal {
  key: string;
  /**
   * Nome para exibicao. Prefere o apelido, porque e como o usuario se refere a
   * contraparte; sem apelido, cai no nome oficial.
   */
  name: string;
  /**
   * Nome oficial: como a contraparte aparece no extrato. Fica separado do
   * apelido porque sao coisas diferentes — este identifica e concilia, o outro
   * so serve para ler. Some-los num campo so, como era antes, fazia o apelido
   * apagar a unica pista de qual contraparte era aquela.
   */
  officialName?: string;
  /** Apelido cadastrado, quando existe. */
  alias?: string;
  document?: string;
  documentType?: string;
  category?: string;
  subcategory?: string;
  /**
   * Palpite a partir da categoria que a Pluggy atribuiu aos lancamentos. Serve
   * para preencher o formulario, nunca para dar a contraparte como classificada:
   * so vale o que o usuario confirmou.
   */
  suggestedCategory?: string;
  /** Total que saiu para esta contraparte, positivo. */
  sent: number;
  /** Total que veio dela, positivo. */
  received: number;
  /** received - sent. Negativo significa que voce e pagador liquido. */
  net: number;
  count: number;
  /** Data da transacao mais recente, para ordenar por atividade. */
  lastDate: string;
  self: boolean;
  /**
   * Lancamentos que compoem os totais, do mais recente para o mais antigo.
   * Um nome de contraparte sozinho raramente diz o que foi — sobretudo quando e
   * o proprio banco — entao a linha precisa poder ser aberta.
   */
  transactions: CounterpartyEntry[];
}

export interface CounterpartyEntry {
  id: string;
  date: string;
  description: string;
  amount: number;
  category?: string | null;
  accountId?: string;
  details?: Detail[];
}

interface TransacaoComContraparte {
  id?: string;
  description?: string;
  category?: string | null;
  amount: number;
  date: string;
  accountId?: string;
  details?: Detail[];
  counterparty?: Counterparty | null;
}

/**
 * Totais por contraparte, do maior movimento para o menor.
 *
 * Enviado e recebido ficam separados de proposito: somar os dois num numero so
 * esconde a diferenca entre alguem para quem voce so paga e alguem com quem voce
 * troca dinheiro nos dois sentidos.
 */
export function aggregateCounterparties(
  transactions: TransacaoComContraparte[],
  registry: CounterpartyRegistry = {},
): CounterpartyTotal[] {
  const buckets = new Map<string, CounterpartyTotal>();

  for (const transaction of transactions) {
    const contraparte = transaction.counterparty;
    if (!contraparte) continue;

    const bucket = buckets.get(contraparte.key) ?? {
      key: contraparte.key,
      name: "",
      document: contraparte.document,
      documentType: contraparte.documentType,
      sent: 0,
      received: 0,
      net: 0,
      count: 0,
      lastDate: transaction.date,
      self: contraparte.self,
      transactions: [],
    };

    bucket.transactions.push({
      id: transaction.id ?? `${contraparte.key}-${bucket.transactions.length}`,
      date: transaction.date,
      description: transaction.description ?? "",
      amount: transaction.amount,
      category: transaction.category ?? null,
      accountId: transaction.accountId,
      details: transaction.details,
    });

    if (transaction.amount < 0) bucket.sent += -transaction.amount;
    else bucket.received += transaction.amount;

    bucket.count += 1;
    bucket.net = bucket.received - bucket.sent;
    if (transaction.date > bucket.lastDate) bucket.lastDate = transaction.date;

    // O nome pode faltar em algumas transacoes e vir em outras da mesma
    // contraparte. Ficamos com o mais longo, nao com o primeiro: depois da
    // conciliacao o mesmo balde recebe o nome recortado do print e o nome
    // inteiro do Open Finance, e a ordem em que chegam e acaso — o completo e
    // que identifica.
    if (contraparte.name && contraparte.name.length > bucket.name.length) {
      bucket.name = contraparte.name;
    }
    if (!bucket.document && contraparte.document) bucket.document = contraparte.document;

    buckets.set(contraparte.key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => {
      bucket.transactions.sort((a, b) => b.date.localeCompare(a.date));

      // Categoria mais frequente entre os lancamentos, como sugestao.
      const contagem = new Map<string, number>();
      for (const lancamento of bucket.transactions) {
        const categoria = lancamento.category?.trim();
        if (categoria) contagem.set(categoria, (contagem.get(categoria) ?? 0) + 1);
      }
      const sugestao = [...contagem.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
      const cadastro = registry[bucket.key];

      // O nome oficial cadastrado tem precedencia sobre o que veio do extrato:
      // e a correcao explicita do usuario sobre um nome truncado ou sujo.
      const oficial =
        cadastro?.officialName ||
        bucket.name ||
        (bucket.key === NAO_IDENTIFICADA ? "Contraparte nao identificada" : undefined);

      return {
        ...bucket,
        officialName: oficial,
        alias: cadastro?.alias,
        name: cadastro?.alias || oficial || bucket.key,
        category: cadastro?.category,
        subcategory: cadastro?.subcategory,
        suggestedCategory: sugestao ? translateCategory(sugestao) : undefined,
      };
    })
    .sort((a, b) => b.sent + b.received - (a.sent + a.received));
}

export interface CategoryRollup {
  category: string;
  sent: number;
  received: number;
  count: number;
  subcategories: {
    subcategory: string;
    sent: number;
    received: number;
    count: number;
    counterparties: number;
  }[];
}

const SEM_CATEGORIA = "Sem categoria";
const SEM_SUBCATEGORIA = "Sem subcategoria";

/**
 * Totais por categoria e subcategoria. E o que a hierarquia paga: ver quanto foi
 * para "Viagem" no total e, dentro dela, quanto foi para cada ocasiao.
 */
export function groupByCategory(counterparties: CounterpartyTotal[]): CategoryRollup[] {
  const categorias = new Map<string, CategoryRollup>();

  for (const c of counterparties) {
    const nomeCategoria = c.category?.trim() || SEM_CATEGORIA;
    const nomeSub = c.subcategory?.trim() || SEM_SUBCATEGORIA;

    const categoria = categorias.get(nomeCategoria) ?? {
      category: nomeCategoria,
      sent: 0,
      received: 0,
      count: 0,
      subcategories: [],
    };

    categoria.sent += c.sent;
    categoria.received += c.received;
    categoria.count += c.count;

    const sub = categoria.subcategories.find((s) => s.subcategory === nomeSub);
    if (sub) {
      sub.sent += c.sent;
      sub.received += c.received;
      sub.count += c.count;
      sub.counterparties += 1;
    } else {
      categoria.subcategories.push({
        subcategory: nomeSub,
        sent: c.sent,
        received: c.received,
        count: c.count,
        counterparties: 1,
      });
    }

    categorias.set(nomeCategoria, categoria);
  }

  const ordenar = <T extends { sent: number; received: number }>(a: T, b: T) =>
    b.sent + b.received - (a.sent + a.received);

  return [...categorias.values()]
    .map((categoria) => ({
      ...categoria,
      subcategories: [...categoria.subcategories].sort(ordenar),
    }))
    .sort(ordenar);
}
