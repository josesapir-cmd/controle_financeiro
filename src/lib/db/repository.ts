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
 * Identidade estavel de uma conta: instituicao mais numero.
 *
 * Nao usamos o id da Pluggy nem o do item porque ambos mudam ao reconectar um
 * banco — e amarrar o historico a eles significaria perde-lo a cada
 * reconexao, que e exatamente o que a persistencia veio evitar.
 */
export function accountFingerprint(connectorName: string, number: string | null | undefined): string {
  return fingerprint("account", `${connectorName}|${number ?? ""}`);
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
  name?: string | null;
  number?: string | null;
  balance: number;
  currency?: string | null;
}

/** Devolve o id interno da conta, criando ou atualizando pelo fingerprint. */
export async function upsertAccount(db: Db, conta: AccountInput): Promise<string> {
  const fp = accountFingerprint(conta.connectorName, conta.number);

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
          counterparty_doc_enc, counterparty_self, details_enc, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, now())
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
      ],
    );
    gravadas += 1;
  }

  return gravadas;
}

export async function listAccounts(db: Db): Promise<AccountRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT id, fingerprint, item_id, connector_name, type, subtype,
            name_enc, number_enc, balance, currency, updated_at
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
  alias: string | null;
}

export async function listLabels(db: Db): Promise<LabelRow[]> {
  const linhas = await db.query<Record<string, unknown>>(
    `SELECT fingerprint, category, subcategory, alias_enc FROM counterparty_labels`,
  );

  return linhas.map((linha) => ({
    fingerprint: String(linha.fingerprint),
    category: linha.category ? String(linha.category) : null,
    subcategory: linha.subcategory ? String(linha.subcategory) : null,
    alias: decryptOptional(linha.alias_enc as string | null),
  }));
}

export async function setLabel(
  db: Db,
  chave: string,
  valores: { category?: string | null; subcategory?: string | null; alias?: string | null },
): Promise<void> {
  const fp = counterpartyFingerprint(chave);
  const category = valores.category?.trim() || null;
  const subcategory = valores.subcategory?.trim() || null;
  const alias = valores.alias?.trim() || null;

  // Registro sem nenhum rotulo nao precisa ocupar espaco.
  if (!category && !subcategory && !alias) {
    await db.query(`DELETE FROM counterparty_labels WHERE fingerprint = $1`, [fp]);
    return;
  }

  await db.query(
    `INSERT INTO counterparty_labels (fingerprint, category, subcategory, alias_enc, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (fingerprint) DO UPDATE
       SET category = EXCLUDED.category,
           subcategory = EXCLUDED.subcategory,
           alias_enc = EXCLUDED.alias_enc,
           updated_at = now()`,
    [fp, category, subcategory, encryptOptional(alias)],
  );
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
