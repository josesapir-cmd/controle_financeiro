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
const TIMEOUT_PADRAO_MS = 15_000;

/**
 * Le um numero do ambiente com recuo seguro.
 *
 * `Number(process.env.X ?? padrao)` parece equivalente e nao e: `??` so cobre
 * null e undefined, entao uma variavel definida porem VAZIA passa direto e
 * `Number("")` vale 0. Foi o que aconteceu — um PLUGGY_TIMEOUT_MS vazio em
 * producao virou timeout de zero milissegundos, abortando toda chamada antes de
 * sair, todos os dias, com a mensagem "nao respondeu em 0s".
 *
 * Valor invalido tambem cai no padrao: um timeout de zero e pior que nenhum
 * timeout, porque quebra tudo em vez de apenas nao proteger.
 */
function numeroDoAmbiente(nome: string, padrao: number): number {
  const bruto = (process.env[nome] ?? "").trim();
  if (!bruto) return padrao;

  const valor = Number(bruto);
  return Number.isFinite(valor) && valor > 0 ? valor : padrao;
}

const REQUEST_TIMEOUT_MS = numeroDoAmbiente("PLUGGY_TIMEOUT_MS", TIMEOUT_PADRAO_MS);

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
 * Paginacao da v2.
 *
 * A resposta traz `next`: ou `null`, ou uma query string pronta como
 * "?accountId=...&after=<token>". Basta concatena-la ao endpoint — nao ha
 * parametro de cursor para montar.
 *
 * Foi exatamente aqui que erramos antes: o codigo tratava `next` como valor de
 * um parametro `cursor`, e a v2, que valida parametros de forma estrita,
 * respondia 400 "property cursor should not exist". As conexoes que nao tinham
 * proxima pagina passavam ilesas, o que mascarou o problema — e as que tinham
 * ficavam truncadas em 500 lancamentos.
 */
export function nextQuery(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const proximo = (body as { next?: unknown }).next;
  return typeof proximo === "string" && proximo.length > 0 ? proximo : null;
}

function extractResults<T>(body: unknown): T[] {
  if (!body || typeof body !== "object") return [];
  const record = body as Record<string, unknown>;
  for (const key of ["results", "data", "transactions"]) {
    if (Array.isArray(record[key])) return record[key] as T[];
  }
  return [];
}

/** Data de uma transacao no fuso local, para comparar com a janela pedida. */
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
 * Transacoes de uma conta na janela pedida.
 *
 * A v2 nao aceita filtro de data — `from`, `to` e `pageSize` sao recusados —
 * entao pedimos as paginas e recortamos o periodo em codigo. Para nao varrer o
 * historico inteiro, paramos assim que uma pagina traz algo anterior ao inicio
 * da janela: a API devolve da transacao mais recente para a mais antiga.
 */
export async function getTransactions(
  accountId: string,
  options: { from?: string; to?: string } = {},
): Promise<Transaction[]> {
  const collected: Transaction[] = [];
  let caminho = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;

  // Teto de seguranca contra um `next` que nunca termine.
  for (let paginas = 0; paginas < 200; paginas += 1) {
    const body = await request<unknown>(caminho);
    const results = extractResults<Transaction>(body);
    collected.push(...results);

    if (results.length === 0) break;
    if (options.from && results.some((t) => transactionDay(t) < options.from!)) break;

    const proximo = nextQuery(body);
    if (!proximo) break;
    caminho = `/v2/transactions${proximo}`;
  }

  return collected.filter((transaction) => withinPeriod(transaction, options));
}

export async function deleteItem(itemId: string): Promise<void> {
  await request<unknown>(`/items/${itemId}`, { method: "DELETE" });
}
