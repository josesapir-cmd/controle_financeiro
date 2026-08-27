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

/** Categoria atribuida pelo usuario a uma contraparte. */
export interface CounterpartyRegistry {
  [key: string]: { category?: string; alias?: string };
}

export interface CounterpartyTotal {
  key: string;
  /** Nome para exibicao: apelido cadastrado, nome do banco, ou recuo. */
  name: string;
  document?: string;
  documentType?: string;
  category?: string;
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
}

interface TransacaoComContraparte {
  amount: number;
  date: string;
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
    };

    if (transaction.amount < 0) bucket.sent += -transaction.amount;
    else bucket.received += transaction.amount;

    bucket.count += 1;
    bucket.net = bucket.received - bucket.sent;
    if (transaction.date > bucket.lastDate) bucket.lastDate = transaction.date;

    // O nome pode faltar em algumas transacoes e vir em outras da mesma
    // contraparte; ficamos com o primeiro que aparecer.
    if (!bucket.name && contraparte.name) bucket.name = contraparte.name;
    if (!bucket.document && contraparte.document) bucket.document = contraparte.document;

    buckets.set(contraparte.key, bucket);
  }

  return [...buckets.values()]
    .map((bucket) => {
      const cadastro = registry[bucket.key];
      return {
        ...bucket,
        name:
          cadastro?.alias ||
          bucket.name ||
          (bucket.key === NAO_IDENTIFICADA ? "Contraparte nao identificada" : bucket.key),
        category: cadastro?.category,
      };
    })
    .sort((a, b) => b.sent + b.received - (a.sent + a.received));
}
