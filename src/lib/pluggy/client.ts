import { localDay } from "@/lib/finance/dates";
import type { Account, Item, Paginated, Transaction } from "./types";

const DEFAULT_API_URL = "https://api.pluggy.ai";

/**
 * O /auth devolve um JWT de 2 horas. Renovamos com 5 minutos de folga para
 * nao esbarrar na expiracao no meio de uma sequencia de chamadas.
 */
const API_KEY_TTL_MS = 2 * 60 * 60 * 1000;
const RENEWAL_MARGIN_MS = 5 * 60 * 1000;

/**
 * Toda chamada externa feita durante a renderizacao no servidor precisa de
 * limite de tempo. Sem isso, uma API lenta nao vira erro — vira pagina em branco
 * carregando para sempre, que e muito pior de diagnosticar do que uma mensagem.
 */
const REQUEST_TIMEOUT_MS = Number(process.env.PLUGGY_TIMEOUT_MS ?? 15000);

function timeoutSignal(): AbortSignal {
  return AbortSignal.timeout(REQUEST_TIMEOUT_MS);
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function describeNetworkError(error: unknown, path: string): PluggyError {
  if (isTimeout(error)) {
    return new PluggyError(
      `A Pluggy nao respondeu em ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s (${path}).`,
      504,
      path,
    );
  }
  const detalhe = error instanceof Error ? error.message : "falha de rede";
  return new PluggyError(`Nao foi possivel falar com a Pluggy (${path}): ${detalhe}`, 502, path);
}

export class PluggyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
    readonly errorId?: string,
  ) {
    super(message);
    this.name = "PluggyError";
  }
}

interface Credentials {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

function readCredentials(): Credentials {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET precisam estar definidos. " +
        "Copie .env.example para .env.local e preencha os valores.",
    );
  }

  return {
    clientId,
    clientSecret,
    apiUrl: process.env.PLUGGY_API_URL || DEFAULT_API_URL,
  };
}

let cachedApiKey: { value: string; expiresAt: number } | null = null;

/** Exposto para os testes; nao ha motivo para chamar isto em producao. */
export function resetApiKeyCache(): void {
  cachedApiKey = null;
}

async function getApiKey(): Promise<string> {
  if (cachedApiKey && Date.now() < cachedApiKey.expiresAt) {
    return cachedApiKey.value;
  }

  const { clientId, clientSecret, apiUrl } = readCredentials();

  let response: Response;
  try {
    response = await fetch(`${apiUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId, clientSecret }),
      cache: "no-store",
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw describeNetworkError(error, "/auth");
  }

  const body = await readBody(response);

  if (!response.ok) {
    throw new PluggyError(
      messageFrom(body, "Falha ao autenticar na Pluggy"),
      response.status,
      "/auth",
      errorIdFrom(body),
    );
  }

  const apiKey = (body as { apiKey?: unknown }).apiKey;
  if (typeof apiKey !== "string" || apiKey.length === 0) {
    throw new PluggyError("Resposta de /auth sem apiKey", 502, "/auth");
  }

  cachedApiKey = { value: apiKey, expiresAt: Date.now() + API_KEY_TTL_MS - RENEWAL_MARGIN_MS };
  return apiKey;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function messageFrom(body: unknown, fallback: string): string {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message: unknown }).message;
    if (typeof message === "string") return message;
  }
  return fallback;
}

function errorIdFrom(body: unknown): string | undefined {
  if (body && typeof body === "object" && "errorId" in body) {
    const errorId = (body as { errorId: unknown }).errorId;
    if (typeof errorId === "string") return errorId;
  }
  return undefined;
}

async function request<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const { apiUrl } = readCredentials();
  const apiKey = await getApiKey();

  const url = new URL(`${apiUrl}${path}`);
  for (const [key, value] of Object.entries(init.query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        "X-API-KEY": apiKey,
        "Content-Type": "application/json",
        ...init.headers,
      },
      cache: "no-store",
      signal: timeoutSignal(),
    });
  } catch (error) {
    throw describeNetworkError(error, path);
  }

  const body = await readBody(response);

  if (!response.ok) {
    throw new PluggyError(
      messageFrom(body, `Pluggy respondeu ${response.status} em ${path}`),
      response.status,
      path,
      errorIdFrom(body),
    );
  }

  return body as T;
}

/**
 * Token de curta duracao (30 min) consumido pelo widget Pluggy Connect no
 * navegador. E o unico segredo que pode sair do servidor: o clientSecret nunca sai.
 */
export async function createConnectToken(itemId?: string): Promise<string> {
  const body = await request<{ accessToken?: string }>("/connect_token", {
    method: "POST",
    body: JSON.stringify(itemId ? { itemId } : {}),
  });

  if (!body.accessToken) {
    throw new PluggyError("Resposta de /connect_token sem accessToken", 502, "/connect_token");
  }
  return body.accessToken;
}

export function getItem(itemId: string): Promise<Item> {
  return request<Item>(`/items/${itemId}`);
}

export async function getAccounts(itemId: string): Promise<Account[]> {
  const body = await request<Paginated<Account>>("/accounts", { query: { itemId } });
  return body.results ?? [];
}

/**
 * A rota /transactions foi descontinuada (410 ENDPOINT_DEPRECATED). A v2 usa
 * paginacao por cursor, entao seguimos o cursor ate ele vir vazio.
 *
 * O nome do campo de cursor varia entre implementacoes, e a resposta da v2 nao
 * esta documentada aqui — por isso aceitamos as variacoes mais comuns em vez de
 * fixar uma e quebrar em producao.
 */
function extractResults<T>(body: unknown): T[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of ["results", "data", "transactions"]) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

function extractCursor(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const record = body as Record<string, unknown>;

  for (const key of ["nextCursor", "next_cursor", "cursor", "next"]) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) return value;
  }

  // Alguns formatos aninham a paginacao em um objeto.
  for (const key of ["page", "pagination", "meta"]) {
    const nested = record[key];
    if (nested && typeof nested === "object") {
      const inner = extractCursor(nested);
      if (inner) return inner;
    }
  }

  return null;
}

/**
 * Dia da transacao no fuso local. Nao use slice(0,10) na data ISO: ela vem em
 * UTC, e transacoes noturnas cairiam no dia seguinte.
 */
function transactionDay(transaction: Transaction): string {
  return localDay(transaction.date);
}

export function withinPeriod(
  transaction: Transaction,
  period: { from?: string; to?: string },
): boolean {
  const day = transactionDay(transaction);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

/**
 * A v2 rejeitou `pageSize`, `from` e `to` — valida parametros de forma estrita e
 * seus nomes de filtro nao estao documentados aqui. Em vez de adivinhar mais um
 * nome e arriscar outro 400, enviamos apenas accountId e cursor, e recortamos o
 * periodo em codigo.
 *
 * O custo disso e trazer transacoes fora da janela. Mitigamos parando de paginar
 * assim que uma pagina traz algo anterior ao inicio do periodo: a API devolve da
 * mais recente para a mais antiga, entao dali em diante so vem coisa velha.
 */
export async function getTransactions(
  accountId: string,
  options: { from?: string; to?: string } = {},
): Promise<Transaction[]> {
  const collected: Transaction[] = [];
  let cursor: string | undefined;

  for (let requests = 0; requests < 50; requests += 1) {
    const body = await request<unknown>("/v2/transactions", {
      query: { accountId, cursor },
    });

    const results = extractResults<Transaction>(body);
    collected.push(...results);

    if (results.length === 0) break;

    // Ja alcancamos o inicio da janela: o resto da paginacao seria descartado.
    if (options.from && results.some((t) => transactionDay(t) < options.from!)) break;

    const next = extractCursor(body);
    if (!next || next === cursor) break;
    cursor = next;
  }

  return collected.filter((transaction) => withinPeriod(transaction, options));
}

export async function deleteItem(itemId: string): Promise<void> {
  await request<unknown>(`/items/${itemId}`, { method: "DELETE" });
}
