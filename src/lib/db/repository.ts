import { decryptOptional, encryptOptional, fingerprint } from "@/lib/crypto";
import type { Db } from "./adapter";

/**
 * Acesso ao banco, com a criptografia aplicada na fronteira: o resto do app
 * trabalha sempre com valores em claro e nunca precisa lembrar de cifrar.
 *
 * Os campos identificadores vao cifrados; valores, datas e categorias vao em
 * claro porque sao o que as telas agregam no SQL.
 */

export interface ConnectionRow {
  itemId: string;
  connectorName: string;
  connectorId?: number | null;
  status?: string | null;
  lastSyncedAt?: Date | null;
  lastSyncError?: string | null;
}

export interface AccountRow {
  id: string;
  fingerprint: string;
  itemId: string | null;
  connectorName: string;
  type: "BANK" | "CREDIT";
  subtype: string | null;
  name: string | null;
  number: string | null;
  balance: number;
  currency: string;
  /** 'pluggy' quando veio do Open Finance, 'manual' quando foi cadastrada aqui. */
  origin: string;
  updatedAt: Date;
}

export interface TransactionRow {
  id: string;
  accountId: string;
  postedAt: Date;
  localDay: string;
  amount: number;
  currency: string;
  category: string | null;
  categoryId: string | null;
  description: string | null;
  counterpartyFingerprint: string | null;
  counterpartyName: string | null;
  counterpartyDocument: string | null;
  counterpartySelf: boolean;
  details: { label: string; value: string }[] | null;
}

/**
 * Identidade estavel de uma conta.
 *
 * Formada apenas por dados da propria conta — nome, numero e subtipo — e nunca
 * pelo id da Pluggy, pelo item ou pelo nome da instituicao:
 *
 * - id da conta e do item mudam ao reconectar um banco, e amarrar o historico a
 *   eles significaria perde-lo a cada reconexao.
 * - o nome da instituicao vem do item, e ha conexoes reais que respondem 404 em
 *   GET /items/{id} enquanto entregam contas normalmente. Se a identidade
 *   dependesse dele, a mesma conta ganharia fingerprint diferente conforme o
 *   item estivesse legivel ou nao, duplicando o historico.
 *
 * O subtipo e o nome entram porque numero sozinho colide: no BTG, "BTG Pactual
 * WM" e "BTG Banking" sao contas correntes distintas com o mesmo numero.
 *
 * O nome aqui e o CRU da conta. O marketingName nao serve: e campo de
 * exibicao, aparece e some entre sincronizacoes, e usa-lo criava uma conta nova
 * a cada mudanca, partindo o historico.
 */
export function accountFingerprint(
  name: string | null | undefined,
  number: string | null | undefined,
  subtype: string | null | undefined,
): string {
  return fingerprint("account", `${name ?? ""}|${number ?? ""}|${subtype ?? ""}`);
}

export function counterpartyFingerprint(chave: string): string {
  return fingerprint("counterparty", chave);
}

function numero(valor: unknown): number {
  return typeof valor === "number" ? valor : Number(valor ?? 0);
}

export async function upsertConnection(db: Db, conexao: ConnectionRow): Promise<void> {
  await db.query(
    `INSERT INTO connections (item_id, connector_id, connector_name, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (item_id) DO UPDATE
       SET connector_id = EXCLUDED.connector_id,
           connector_name = EXCLUDED.connector_name,
           status = EXCLUDED.status`,
    [conexao.itemId, conexao.connectorId ?? null, conexao.connectorName, conexao.status ?? null],
  );
}

export async function markSync(
  db: Db,
  itemId: string,
  erro: string | null,
): Promise<void> {
  await db.query(
    `UPDATE connections SET last_synced_at = now(), last_sync_error = $2 WHERE item_id = $1`,
    [itemId, erro],
  );
}

export interface AccountInput {
  itemId: string;
  pluggyAccountId: string;
  connectorName: string;
  type: "BANK" | "CREDIT";
  subtype?: string | null;
  /**
   * Nome usado na identidade. Precisa ser o nome cru da conta, nunca o
   * marketingName: este ultimo e campo de exibicao, pode estar ausente numa
   * sincronizacao e presente noutra, e usa-lo na identidade parte o historico
   * em duas contas — foi o que aconteceu com o Nubank ao ser reconectado.
   */
  identityName?: string | null;
  /** Nome para exibicao. Pode mudar sem consequencia. */
  name?: string | null;
  number?: string | null;
  balance: number;
  currency?: string | null;
}

/** Devolve o id interno da conta, criando ou atualizando pelo fingerprint. */
export async function upsertAccount(db: Db, conta: AccountInput): Promise<string> {
  const fp = accountFingerprint(
    conta.identityName ?? conta.name,
    conta.number,
    conta.subtype,
  );

  const linhas = await db.query<{ id: string }>(
    `INSERT INTO accounts
       (fingerprint, item_id, pluggy_account_id, connector_name, type, subtype,
        name_enc, number_enc, balance, currency, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (fingerprint) DO UPDATE
       SET item_id = EXCLUDED.item_id,
           pluggy_account_id = EXCLUDED.pluggy_account_id,
           type = EXCLUDED.type,
           subtype = EXCLUDED.subtype,
           name_enc = EXCLUDED.name_enc,
           number_enc = EXCLUDED.number_enc,
           balance = EXCLUDED.balance,
           currency = EXCLUDED.currency,
           -- Reconectar reativa: uma conta que voltou a sincronizar nao pode
           -- continuar marcada como arquivada.
           archived_at = NULL,
           updated_at = now()
     RETURNING id`,
    [
      fp,
      conta.itemId,
      conta.pluggyAccountId,
      conta.connectorName,
      conta.type,
      conta.subtype ?? null,
      encryptOptional(conta.name),
      encryptOptional(conta.number),
      conta.balance,
      conta.currency ?? "BRL",
    ],
  );

  return linhas[0].id;
}

export interface TransactionInput {
  id: string;
  accountId: string;
  postedAt: Date | string;
  localDay: string;
  amount: number;
  currency?: string | null;
  category?: string | null;
  categoryId?: string | null;
  description?: string | null;
  counterpartyKey?: string | null;
  counterpartyName?: string | null;
  counterpartyDocument?: string | null;
  counterpartySelf?: boolean;
  details?: { label: string; value: string }[] | null;
  /** 'pluggy' (padrao) ou 'manual', para o que entrou por print ou planilha. */
  origin?: string;
}

/**
 * Grava um lote de transacoes.
 *
 * A chave e o id da Pluggy, entao re-sincronizar o mesmo periodo atualiza em
 * vez de duplicar. `first_seen_at` nao e tocado no update: e o registro de
 * quando aquele lancamento entrou no nosso historico, nao de quando a Pluggy o
 * reapresentou.
 */
export async function upsertTransactions(
  db: Db,
  transacoes: TransactionInput[],
): Promise<number> {
  let gravadas = 0;

  for (const t of transacoes) {
    await db.query(
      `INSERT INTO transactions
         (id, account_id, posted_at, local_day, amount, currency, category, category_id,
          description_enc, counterparty_fingerprint, counterparty_name_enc,
          counterparty_doc_enc, counterparty_self, details_enc, origin, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, now())
       ON CONFLICT (id) DO UPDATE
         SET account_id = EXCLUDED.account_id,
             posted_at = EXCLUDED.posted_at,
             local_day = EXCLUDED.local_day,
             amount = EXCLUDED.amount,
             category = EXCLUDED.category,
             category_id = EXCLUDED.category_id,
             description_enc = EXCLUDED.description_enc,
             counterparty_fingerprint = EXCLUDED.counterparty_fingerprint,
             counterparty_name_enc = EXCLUDED.counterparty_name_enc,
             counterparty_doc_enc = EXCLUDED.counterparty_doc_enc,
             counterparty_self = EXCLUDED.counterparty_self,
             details_enc = EXCLUDED.details_enc,
             origin = EXCLUDED.origin,
             updated_at = now()`,
      [
        t.id,
        t.accountId,
        t.postedAt instanceof Date ? t.postedAt.toISOString() : t.postedAt,
        t.localDay,
        t.amount,
        t.currency ?? "BRL",
        t.category ?? null,
        t.categoryId ?? null,
        encryptOptional(t.description),
        t.counterpartyKey ? counterpartyFingerprint(t.counterpartyKey) : null,
        encryptOptional(t.counterpartyName),
        encryptOptional(t.counterpartyDocument),
        t.counterpartySelf ?? false,
        t.details && t.details.length ? encryptOptional(JSON.stringify(t.details)) : null,
        t.origin ?? "pluggy",
      ],
    );
    gravadas += 1;
  }

  return gravadas;
}

export async function listAccounts(db: Db): Promise<AccountRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, fingerprint, item_id, connector_name, type, subtype,
            name_enc, number_enc, balance, currency, origin, updated_at
       FROM accounts
      WHERE archived_at IS NULL
      ORDER BY connector_name, type`,
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    fingerprint: String(linha.fingerprint),
    itemId: linha.item_id ? String(linha.item_id) : null,
    connectorName: String(linha.connector_name),
    type: linha.type as "BANK" | "CREDIT",
    subtype: linha.subtype ? String(linha.subtype) : null,
    name: decryptOptional(linha.name_enc as string | null),
    number: decryptOptional(linha.number_enc as string | null),
    balance: numero(linha.balance),
    currency: String(linha.currency),
    origin: linha.origin ? String(linha.origin) : "pluggy",
    updatedAt: new Date(linha.updated_at as string),
  }));
}

export interface TransactionQuery {
  from?: string;
  to?: string;
  accountIds?: string[];
}

export async function listTransactions(
  db: Db,
  filtro: TransactionQuery = {},
): Promise<TransactionRow[]> {
  const condicoes: string[] = [];
  const parametros: unknown[] = [];

  if (filtro.from) {
    parametros.push(filtro.from);
    condicoes.push(`local_day >= $${parametros.length}`);
  }
  if (filtro.to) {
    parametros.push(filtro.to);
    condicoes.push(`local_day <= $${parametros.length}`);
  }
  if (filtro.accountIds && filtro.accountIds.length > 0) {
    parametros.push(filtro.accountIds);
    condicoes.push(`account_id = ANY($${parametros.length}::uuid[])`);
  }

  const where = condicoes.length ? `WHERE ${condicoes.join(" AND ")}` : "";

  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, account_id, posted_at, local_day, amount, currency, category, category_id,
            description_enc, counterparty_fingerprint, counterparty_name_enc,
            counterparty_doc_enc, counterparty_self, details_enc
       FROM transactions
       ${where}
      ORDER BY posted_at DESC`,
    parametros,
  );

  return linhas.map((linha) => {
    const detalhes = decryptOptional(linha.details_enc as string | null);
    return {
      id: String(linha.id),
      accountId: String(linha.account_id),
      postedAt: new Date(linha.posted_at as string),
      // local_day vem como Date em alguns drivers e como string em outros;
      // normalizamos para AAAA-MM-DD, que e o formato que as telas comparam.
      localDay:
        linha.local_day instanceof Date
          ? (linha.local_day as Date).toISOString().slice(0, 10)
          : String(linha.local_day).slice(0, 10),
      amount: numero(linha.amount),
      currency: String(linha.currency),
      category: linha.category ? String(linha.category) : null,
      categoryId: linha.category_id ? String(linha.category_id) : null,
      description: decryptOptional(linha.description_enc as string | null),
      counterpartyFingerprint: linha.counterparty_fingerprint
        ? String(linha.counterparty_fingerprint)
        : null,
      counterpartyName: decryptOptional(linha.counterparty_name_enc as string | null),
      counterpartyDocument: decryptOptional(linha.counterparty_doc_enc as string | null),
      counterpartySelf: Boolean(linha.counterparty_self),
      details: detalhes ? (JSON.parse(detalhes) as { label: string; value: string }[]) : null,
    };
  });
}

export interface LabelRow {
  fingerprint: string;
  category: string | null;
  subcategory: string | null;
  /** Apelido: a abreviacao usada para falar da contraparte. */
  alias: string | null;
  /**
   * Nome oficial: como a contraparte aparece no extrato. Guardado quando o
   * usuario corrige ou fixa o nome — util sobretudo depois de conciliar um nome
   * recortado de print com o nome inteiro do Open Finance.
   */
  officialName: string | null;
}

export async function listLabels(db: Db): Promise<LabelRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT fingerprint, category, subcategory, alias_enc, official_name_enc
       FROM counterparty_labels`,
  );

  return linhas.map((linha) => ({
    fingerprint: String(linha.fingerprint),
    category: linha.category ? String(linha.category) : null,
    subcategory: linha.subcategory ? String(linha.subcategory) : null,
    alias: decryptOptional(linha.alias_enc as string | null),
    officialName: decryptOptional(linha.official_name_enc as string | null),
  }));
}

/**
 * Grava o rotulo de uma contraparte.
 *
 * Recebe o fingerprint pronto, nao a chave original: as telas so conhecem o
 * fingerprint, e calcula-lo de novo aqui produziria um hash de hash, que nunca
 * casaria com as transacoes.
 */
export async function setLabel(
  db: Db,
  fp: string,
  valores: {
    category?: string | null;
    subcategory?: string | null;
    alias?: string | null;
    officialName?: string | null;
  },
): Promise<void> {
  const category = valores.category?.trim() || null;
  const subcategory = valores.subcategory?.trim() || null;
  const alias = valores.alias?.trim() || null;
  const officialName = valores.officialName?.trim() || null;

  // Registro sem nenhum rotulo nao precisa ocupar espaco.
  if (!category && !subcategory && !alias && !officialName) {
    await db.query(`DELETE FROM counterparty_labels WHERE fingerprint = $1`, [fp]);
    return;
  }

  await db.query(
    `INSERT INTO counterparty_labels
       (fingerprint, category, subcategory, alias_enc, official_name_enc, updated_at)
     VALUES ($1, $2, $3, $4, $5, now())
     ON CONFLICT (fingerprint) DO UPDATE
       SET category = EXCLUDED.category,
           subcategory = EXCLUDED.subcategory,
           alias_enc = EXCLUDED.alias_enc,
           official_name_enc = EXCLUDED.official_name_enc,
           updated_at = now()`,
    [fp, category, subcategory, encryptOptional(alias), encryptOptional(officialName)],
  );
}

/**
 * Decisoes de identidade entre contrapartes.
 *
 * Destino preenchido significa "e a mesma contraparte"; destino nulo significa
 * "sao diferentes mesmo, pare de sugerir". Guardamos as duas porque a segunda e
 * informacao tanto quanto a primeira: sem ela, a mesma sugestao recusada
 * voltaria a aparecer para sempre.
 *
 * So a decisao trafega. Os nomes ficam de fora — a comparacao acontece na
 * aplicacao, sobre valores decifrados, e o banco nao precisa ve-los.
 */
export async function listCounterpartyLinks(db: Db): Promise<Record<string, string | null>> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT from_fingerprint, to_fingerprint FROM counterparty_links`,
  );

  const decisoes: Record<string, string | null> = {};
  for (const linha of linhas) {
    decisoes[String(linha.from_fingerprint)] = linha.to_fingerprint
      ? String(linha.to_fingerprint)
      : null;
  }
  return decisoes;
}

export async function setCounterpartyLink(
  db: Db,
  de: string,
  para: string | null,
): Promise<void> {
  // Uma contraparte apontando para si mesma nao e uniao: e ruido que produziria
  // cadeia degenerada no mapa.
  if (!de || de === para) return;

  await db.query(
    `INSERT INTO counterparty_links (from_fingerprint, to_fingerprint, decided_at)
     VALUES ($1, $2, now())
     ON CONFLICT (from_fingerprint) DO UPDATE
       SET to_fingerprint = EXCLUDED.to_fingerprint, decided_at = now()`,
    [de, para],
  );
}

/** Remove a decisao, devolvendo a contraparte a sugestao automatica. */
export async function clearCounterpartyLink(db: Db, de: string): Promise<void> {
  await db.query(`DELETE FROM counterparty_links WHERE from_fingerprint = $1`, [de]);
}

export interface SyncStatus {
  connectorName: string;
  itemId: string;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
}

/**
 * Estado da ultima sincronizacao por conexao. As telas mostram isso para que o
 * usuario distinga "nao houve movimento" de "nao conseguimos sincronizar" — sem
 * essa distincao, dado velho passa por dado atual.
 */
export async function syncStatus(db: Db): Promise<SyncStatus[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT item_id, connector_name, last_synced_at, last_sync_error
       FROM connections ORDER BY connector_name`,
  );

  return linhas.map((linha) => ({
    itemId: String(linha.item_id),
    connectorName: String(linha.connector_name),
    lastSyncedAt: linha.last_synced_at ? new Date(linha.last_synced_at as string) : null,
    lastSyncError: linha.last_sync_error ? String(linha.last_sync_error) : null,
  }));
}

/**
 * Conta virtual do saldo compartilhado do Nubank.
 *
 * Nao existe no Open Finance — a conta corrente so mostra a transferencia
 * mensal com o valor cheio, e os gastos acontecem do outro lado. Sem um lugar
 * para eles, ou o dinheiro some do controle, ou a transferencia e contada como
 * despesa e o detalhe do que foi comprado se perde. A conta virtual resolve as
 * duas coisas: a transferencia continua sendo movimentacao e os gastos entram
 * aqui, um a um.
 *
 * Fica com `origin = 'manual'` e saldo zero: nao ha saldo apurado para ela, e
 * somar zero ao patrimonio seria menos errado do que somar um numero inventado
 * — por isso as telas de saldo a ignoram (ver finance/service.ts).
 */
export const CONTA_SALDO_COMPARTILHADO = {
  connectorName: "Saldo compartilhado (Nubank)",
  name: "Saldo compartilhado",
  subtype: "SHARED_BALANCE",
} as const;

/** Cria a conta virtual se ainda nao existir e devolve o id interno. */
export async function ensureSharedBalanceAccount(db: Db): Promise<string> {
  const fp = accountFingerprint(
    CONTA_SALDO_COMPARTILHADO.name,
    null,
    CONTA_SALDO_COMPARTILHADO.subtype,
  );

  const linhas = await db.query<{ id: string }>(
    `INSERT INTO accounts
       (fingerprint, item_id, pluggy_account_id, connector_name, type, subtype,
        name_enc, number_enc, balance, currency, origin, updated_at)
     VALUES ($1, NULL, NULL, $2, 'BANK', $3, $4, NULL, 0, 'BRL', 'manual', now())
     ON CONFLICT (fingerprint) DO UPDATE
       SET connector_name = EXCLUDED.connector_name,
           name_enc = EXCLUDED.name_enc,
           origin = 'manual',
           archived_at = NULL,
           updated_at = now()
     RETURNING id`,
    [
      fp,
      CONTA_SALDO_COMPARTILHADO.connectorName,
      CONTA_SALDO_COMPARTILHADO.subtype,
      encryptOptional(CONTA_SALDO_COMPARTILHADO.name),
    ],
  );

  return linhas[0].id;
}

export type StatusDaImportacao = "pendente" | "confirmado" | "descartado";

/**
 * O id vem da URL, e `id = $1` contra uma coluna uuid estoura com texto que nao
 * seja uuid — erro de servidor onde o certo e "nao encontrado".
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Linha guardada no lote. Mesma forma de `importacao/linhas.ts`, repetida aqui
 * para o repositorio nao depender da camada de importacao — o que ele guarda e
 * JSON cifrado, nao um tipo daquele modulo.
 */
export interface ImportacaoLinha {
  id: string;
  dia: string;
  descricao: string;
  valor: number;
  confianca: string;
  ocorrencia: number;
  envio: number;
  arquivos: string[];
  duplicada: boolean;
}

export interface Importacao {
  id: string;
  createdAt: Date;
  status: StatusDaImportacao;
  /** Quantas imagens ja foram lidas para este lote, somando todos os envios. */
  images: number;
  /** Quantos envios da fila ja entraram. */
  envios: number;
  note: string | null;
  linhas: ImportacaoLinha[];
  /** Produtos lidos de telas de pedido, esperando a mesma conferencia. */
  pedidos: ImportacaoPedido[];
}

/** Produto lido de uma tela de pedidos, ainda sem estar ligado a cobranca. */
export interface ImportacaoPedido {
  id: string;
  loja: string;
  produto: string;
  dia: string;
  valor: number;
  referencia: string | null;
  confianca: string;
  envio: number;
  arquivos: string[];
}

/**
 * Guarda um lote lido de prints, aguardando conferencia.
 *
 * O lote e cifrado inteiro: sao descricoes de gasto, o mesmo tipo de dado que
 * ja vai cifrado em `transactions`. Nada disso vira lancamento antes de o
 * usuario confirmar — valor lido de imagem erra, e gasto errado no painel e
 * pior do que gasto ausente.
 */
export async function criarImportacao(
  db: Db,
  dados: {
    linhas: ImportacaoLinha[];
    pedidos?: ImportacaoPedido[];
    images: number;
    note?: string | null;
  },
): Promise<string> {
  const linhas = await db.query<{ id: string }>(
    `INSERT INTO shared_imports (images, envios, lines_enc, orders_enc, note)
     VALUES ($1, 1, $2, $3, $4) RETURNING id`,
    [
      dados.images,
      encryptOptional(JSON.stringify(dados.linhas)),
      encryptOptional(JSON.stringify(dados.pedidos ?? [])),
      dados.note?.trim() || null,
    ],
  );
  return linhas[0].id;
}

/**
 * Acrescenta um envio da fila a um lote que ainda esta pendente.
 *
 * As linhas ja vem mescladas por quem chamou: a deteccao de repeticao entre
 * envios precisa ver o lote inteiro, e isso e trabalho da camada de
 * importacao, nao do banco. Aqui so persiste o resultado.
 *
 * A condicao `status = 'pendente'` impede que um envio atrasado da fila caia
 * num lote que o usuario ja confirmou — o que somaria linhas nunca conferidas a
 * algo dado por fechado.
 */
export async function anexarImportacao(
  db: Db,
  id: string,
  dados: {
    linhas: ImportacaoLinha[];
    pedidos?: ImportacaoPedido[];
    imagens: number;
    note?: string | null;
  },
): Promise<boolean> {
  if (!UUID.test(id)) return false;

  const linhas = await db.query<{ id: string }>(
    `UPDATE shared_imports
        SET images = images + $2,
            envios = envios + 1,
            lines_enc = $3,
            orders_enc = $5,
            -- As observacoes de cada envio se somam: cada uma fala de imagens
            -- diferentes, e ficar so com a ultima esconderia as anteriores.
            note = NULLIF(trim(both E'\n' from coalesce(note, '') || E'\n' || coalesce($4, '')), '')
      WHERE id = $1 AND status = 'pendente'
      RETURNING id`,
    [
      id,
      dados.imagens,
      encryptOptional(JSON.stringify(dados.linhas)),
      dados.note?.trim() || null,
      encryptOptional(JSON.stringify(dados.pedidos ?? [])),
    ],
  );

  return linhas.length > 0;
}

/** JSON cifrado que pode nao existir em lote antigo: vazio e a resposta certa. */
function listaGuardada<T>(cifrado: unknown): T[] {
  const conteudo = decryptOptional((cifrado as string | null) ?? null);
  if (!conteudo) return [];
  try {
    const dados = JSON.parse(conteudo);
    return Array.isArray(dados) ? (dados as T[]) : [];
  } catch {
    return [];
  }
}

function paraImportacao(linha: Record<string, unknown>): Importacao {
  const conteudo = decryptOptional(linha.lines_enc as string | null);
  return {
    id: String(linha.id),
    createdAt: new Date(linha.created_at as string),
    status: String(linha.status) as StatusDaImportacao,
    images: Number(linha.images ?? 0),
    envios: Number(linha.envios ?? 1),
    note: linha.note ? String(linha.note) : null,
    linhas: conteudo ? (JSON.parse(conteudo) as ImportacaoLinha[]) : [],
    pedidos: listaGuardada<ImportacaoPedido>(linha.orders_enc),
  };
}

/**
 * Le lotes tolerando `orders_enc` ausente.
 *
 * A coluna chegou na migracao 009. Entre subir o codigo e rodar a migracao ha
 * uma janela, e nela a tela de importacoes cairia inteira por causa de uma
 * coluna que so serve para os prints de pedido. Sem ela, os lotes aparecem sem
 * pedidos, que e o que eles tinham mesmo antes de a coluna existir.
 */
async function lerLotes(
  db: Db,
  sufixo: string,
  parametros: unknown[],
): Promise<Importacao[]> {
  const campos = "id, created_at, status, images, envios, lines_enc, note";
  try {
    const linhas = await db.query<Record<string, unknown>>(
      `SELECT ${campos}, orders_enc FROM shared_imports ${sufixo}`,
      parametros,
    );
    return linhas.map(paraImportacao);
  } catch {
    const linhas = await db.query<Record<string, unknown>>(
      `SELECT ${campos} FROM shared_imports ${sufixo}`,
      parametros,
    );
    return linhas.map(paraImportacao);
  }
}

export async function lerImportacao(db: Db, id: string): Promise<Importacao | null> {
  if (!UUID.test(id)) return null;

  const lotes = await lerLotes(db, "WHERE id = $1", [id]);
  return lotes[0] ?? null;
}

export async function listarImportacoes(db: Db, limite = 10): Promise<Importacao[]> {
  return lerLotes(db, "ORDER BY created_at DESC LIMIT $1", [limite]);
}

export async function encerrarImportacao(
  db: Db,
  id: string,
  status: Exclude<StatusDaImportacao, "pendente">,
): Promise<void> {
  if (!UUID.test(id)) return;

  await db.query(
    `UPDATE shared_imports SET status = $2, settled_at = now() WHERE id = $1 AND status = 'pendente'`,
    [id, status],
  );
}

/**
 * Taxonomia de centros de custo.
 *
 * Categoria e o nivel largo ("Viagem", "Familia"); centro de custo e a coisa
 * concreta dentro dela ("Viagem FDS Familia", "Pai"). O centro de custo existe
 * como registro proprio — nao como texto repetido em cada contraparte — porque
 * precisa poder ter orcamento, comeco e fim, e existir antes do primeiro gasto.
 *
 * Nomes ficam em claro, como as categorias ja ficavam: sao rotulos escolhidos
 * pelo usuario e sao o que as telas agrupam no SQL.
 */

export type TipoDeCategoria = "despesa" | "receita" | "movimentacao";

export interface CategoriaRow {
  id: string;
  name: string;
  kind: TipoDeCategoria;
  position: number;
  /** Matiz OKLCH (0-359) da cor de sinalizacao da categoria. */
  hue: number;
  /** O que entra nesta categoria, nas palavras do usuario. Aparece na duvida. */
  hint: string | null;
  archived: boolean;
}

export interface CentroDeCustoRow {
  id: string;
  categoryId: string;
  name: string;
  note: string | null;
  startsOn: string | null;
  endsOn: string | null;
  budget: number | null;
  archived: boolean;
}

function dia(valor: unknown): string | null {
  if (!valor) return null;
  return valor instanceof Date
    ? valor.toISOString().slice(0, 10)
    : String(valor).slice(0, 10);
}

export async function listCategorias(
  db: Db,
  incluirArquivadas = false,
): Promise<CategoriaRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, name, kind, position, hue, hint, archived_at FROM categories
      ${incluirArquivadas ? "" : "WHERE archived_at IS NULL"}
      ORDER BY position, name`,
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    name: String(linha.name),
    kind: String(linha.kind) as TipoDeCategoria,
    position: Number(linha.position ?? 100),
    hue: Number(linha.hue ?? 250),
    hint: linha.hint ? String(linha.hint) : null,
    archived: Boolean(linha.archived_at),
  }));
}

export async function listCentrosDeCusto(
  db: Db,
  incluirArquivados = false,
): Promise<CentroDeCustoRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, category_id, name, note, starts_on, ends_on, budget, archived_at
       FROM cost_centers
      ${incluirArquivados ? "" : "WHERE archived_at IS NULL"}
      ORDER BY name`,
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    categoryId: String(linha.category_id),
    name: String(linha.name),
    note: linha.note ? String(linha.note) : null,
    startsOn: dia(linha.starts_on),
    endsOn: dia(linha.ends_on),
    budget: linha.budget === null || linha.budget === undefined ? null : numero(linha.budget),
    archived: Boolean(linha.archived_at),
  }));
}

/**
 * Encontra a categoria pelo nome, ou cria.
 *
 * Comparacao sem caixa: e o que impede "Viagem" e "viagem" de virarem duas, que
 * era como o texto livre se degradava. O `DO UPDATE` existe so para o RETURNING
 * devolver a linha tambem quando ela ja existia — `DO NOTHING` nao devolve nada.
 */
export async function acharOuCriarCategoria(
  db: Db,
  nome: string,
  kind: TipoDeCategoria = "despesa",
): Promise<string | null> {
  const limpo = nome.trim();
  if (!limpo) return null;

  // Matiz nova espalhada a partir das existentes: 47 graus de passo dao a volta
  // no circulo sem repetir vizinho por muitas categorias.
  const linhas = await db.query<{ id: string }>(
    `INSERT INTO categories (name, kind, hue)
     VALUES ($1, $2, ((SELECT count(*) FROM categories) * 47 + 10) % 360)
     ON CONFLICT (lower(name)) DO UPDATE SET name = categories.name
     RETURNING id`,
    [limpo, kind],
  );
  return linhas[0].id;
}

export async function acharOuCriarCentroDeCusto(
  db: Db,
  categoriaId: string,
  nome: string,
): Promise<string | null> {
  const limpo = nome.trim();
  if (!limpo) return null;

  const linhas = await db.query<{ id: string }>(
    `INSERT INTO cost_centers (category_id, name) VALUES ($1, $2)
     ON CONFLICT (category_id, lower(name)) DO UPDATE SET name = cost_centers.name
     RETURNING id`,
    [categoriaId, limpo],
  );
  return linhas[0].id;
}

export async function salvarCategoria(
  db: Db,
  id: string,
  valores: { name?: string; kind?: TipoDeCategoria; position?: number; hue?: number },
): Promise<void> {
  if (!UUID.test(id)) return;

  const hue =
    valores.hue !== undefined && Number.isFinite(valores.hue)
      ? ((Math.trunc(valores.hue) % 360) + 360) % 360
      : null;

  await db.query(
    `UPDATE categories
        SET name = COALESCE(NULLIF(trim($2), ''), name),
            kind = COALESCE($3, kind),
            position = COALESCE($4, position),
            hue = COALESCE($5, hue)
      WHERE id = $1`,
    [id, valores.name ?? "", valores.kind ?? null, valores.position ?? null, hue],
  );
}

export async function salvarCentroDeCusto(
  db: Db,
  id: string,
  valores: {
    name?: string;
    note?: string | null;
    startsOn?: string | null;
    endsOn?: string | null;
    budget?: number | null;
  },
): Promise<void> {
  if (!UUID.test(id)) return;

  await db.query(
    `UPDATE cost_centers
        SET name = COALESCE(NULLIF(trim($2), ''), name),
            note = $3,
            starts_on = $4,
            ends_on = $5,
            budget = $6
      WHERE id = $1`,
    [
      id,
      valores.name ?? "",
      valores.note?.trim() || null,
      valores.startsOn || null,
      valores.endsOn || null,
      valores.budget ?? null,
    ],
  );
}

/**
 * Arquiva em vez de apagar.
 *
 * Apagar levaria junto a classificacao de todas as contrapartes ligadas ao
 * centro — trabalho que o usuario fez a mao. Arquivado, ele some das listas de
 * escolha mas o historico continua somando onde sempre somou.
 */
export async function arquivarCategoria(db: Db, id: string, arquivar = true): Promise<void> {
  if (!UUID.test(id)) return;
  await db.query(
    `UPDATE categories SET archived_at = ${arquivar ? "now()" : "NULL"} WHERE id = $1`,
    [id],
  );
}

export async function arquivarCentroDeCusto(
  db: Db,
  id: string,
  arquivar = true,
): Promise<void> {
  if (!UUID.test(id)) return;
  await db.query(
    `UPDATE cost_centers SET archived_at = ${arquivar ? "now()" : "NULL"} WHERE id = $1`,
    [id],
  );
}

export async function criarCentroDeCusto(
  db: Db,
  categoriaId: string,
  nome: string,
): Promise<string | null> {
  if (!UUID.test(categoriaId)) return null;
  return acharOuCriarCentroDeCusto(db, categoriaId, nome);
}

/**
 * Liga a contraparte ao centro de custo.
 *
 * Chamada depois de `setLabel`: os campos de texto continuam sendo a interface
 * de quem classifica (digitar e mais rapido que escolher em lista longa), e
 * esta funcao resolve o texto para a taxonomia. Sem isso as duas telas
 * divergiriam — a aba de categorias nunca veria um rotulo criado na mao.
 */
export async function vincularCentroDeCusto(
  db: Db,
  fingerprint: string,
  centroId: string | null,
): Promise<void> {
  await db.query(`UPDATE counterparty_labels SET cost_center_id = $2 WHERE fingerprint = $1`, [
    fingerprint,
    centroId,
  ]);
}

/**
 * Classificacao de UM lancamento.
 *
 * O rotulo do lancamento vence o da contraparte na leitura. E o que permite
 * arrastar um Pix especifico para Viagem sem afirmar que toda transferencia
 * para aquela pessoa e viagem — o caso que a classificacao so por contraparte
 * nao cobria.
 */
export interface RotuloDeLancamento {
  transactionId: string;
  categoryId: string | null;
  costCenterId: string | null;
  note: string | null;
}

export async function listTransactionLabels(db: Db): Promise<RotuloDeLancamento[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT transaction_id, category_id, cost_center_id, note_enc FROM transaction_labels`,
  );

  return linhas.map((linha) => ({
    transactionId: String(linha.transaction_id),
    categoryId: linha.category_id ? String(linha.category_id) : null,
    costCenterId: linha.cost_center_id ? String(linha.cost_center_id) : null,
    note: decryptOptional(linha.note_enc as string | null),
  }));
}

/**
 * Produto comprado, ligado a cobranca que ja existe.
 *
 * A fatura diz "AMAZON BR" e mais nada; o produto vem do print da tela de
 * pedidos da loja. Guardar aqui, e nao em `transactions`, mantem separado o que
 * o banco disse do que a loja disse — e permite mais de um produto na mesma
 * cobranca, que e o caso de um pedido com varios itens cobrado de uma vez.
 */
/** Nome comparavel: sem acento, sem caixa e sem espaco duplo. */
function chaveDoProduto(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export interface ProdutoDoPedido {
  id: string;
  transactionId: string;
  store: string;
  name: string;
  reference: string | null;
  amount: number | null;
  orderedOn: string | null;
}

export async function listTransactionProducts(
  db: Db,
  transactionIds?: string[],
): Promise<ProdutoDoPedido[]> {
  const filtrar = Array.isArray(transactionIds);
  if (filtrar && transactionIds!.length === 0) return [];

  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, transaction_id, store, name_enc, reference_enc, amount, ordered_on
       FROM transaction_products
      ${filtrar ? "WHERE transaction_id = ANY($1)" : ""}
      ORDER BY created_at`,
    filtrar ? [transactionIds] : [],
  );

  return linhas.map((linha) => ({
    id: String(linha.id),
    transactionId: String(linha.transaction_id),
    store: String(linha.store),
    name: decryptOptional(linha.name_enc as string | null) ?? "",
    reference: decryptOptional(linha.reference_enc as string | null),
    amount: linha.amount === null || linha.amount === undefined ? null : Number(linha.amount),
    orderedOn: linha.ordered_on ? String(linha.ordered_on).slice(0, 10) : null,
  }));
}

/**
 * Grava as associacoes confirmadas. Devolve quantas linhas entraram.
 *
 * A impressao digital do nome e o que impede gravar o mesmo produto duas vezes
 * quando o print e lido de novo: o texto cifrado nao serve, porque o nonce e
 * aleatorio e o mesmo nome viraria uma linha nova a cada leitura.
 */
export async function salvarProdutosDoPedido(
  db: Db,
  produtos: {
    transactionId: string;
    store: string;
    name: string;
    reference?: string | null;
    amount?: number | null;
    orderedOn?: string | null;
  }[],
): Promise<number> {
  let gravados = 0;

  for (const produto of produtos) {
    const nome = produto.name.trim();
    if (!produto.transactionId || !nome) continue;

    const linhas = await db.query<{ id: string }>(
      `INSERT INTO transaction_products
         (transaction_id, store, name_enc, reference_enc, name_fp, amount, ordered_on)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (transaction_id, name_fp) DO NOTHING
       RETURNING id`,
      [
        produto.transactionId,
        produto.store.trim() || "Loja",
        encryptOptional(nome),
        encryptOptional(produto.reference?.trim() || null),
        fingerprint("order-product", chaveDoProduto(nome)),
        produto.amount ?? null,
        produto.orderedOn ?? null,
      ],
    );

    gravados += linhas.length;
  }

  return gravados;
}

/** Desfaz uma associacao: o produto sai, a cobranca continua. */
export async function apagarProdutoDoPedido(db: Db, id: string): Promise<void> {
  if (!UUID.test(id)) return;
  await db.query(`DELETE FROM transaction_products WHERE id = $1`, [id]);
}

export async function setTransactionLabel(
  db: Db,
  transactionId: string,
  valores: { categoryId?: string | null; costCenterId?: string | null; note?: string | null },
): Promise<void> {
  if (!transactionId) return;

  const categoria = valores.categoryId && UUID.test(valores.categoryId) ? valores.categoryId : null;
  const centro = valores.costCenterId && UUID.test(valores.costCenterId) ? valores.costCenterId : null;
  const nota = valores.note?.trim() || null;

  // Sem categoria, sem centro e sem comentario nao ha rotulo: a linha sai e o
  // lancamento volta a herdar a classificacao da contraparte.
  if (!categoria && !centro && !nota) {
    await db.query(`DELETE FROM transaction_labels WHERE transaction_id = $1`, [transactionId]);
    return;
  }

  await db.query(
    `INSERT INTO transaction_labels
       (transaction_id, category_id, cost_center_id, note_enc, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (transaction_id) DO UPDATE
       SET category_id = EXCLUDED.category_id,
           cost_center_id = EXCLUDED.cost_center_id,
           note_enc = EXCLUDED.note_enc,
           updated_at = now()`,
    [transactionId, categoria, centro, encryptOptional(nota)],
  );
}
