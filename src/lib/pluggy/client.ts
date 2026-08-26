import type {
  Account,
  Item,
  Paginated,
  Transaction,
} from "./types";

const DEFAULT_API_URL = "https://api.pluggy.ai";

/**
 * O /auth devolve um JWT de 2 horas. Renovamos com 5 minutos de folga para
 * nao esbarrar na expiracao no meio de uma sequencia de chamadas.
 */
const API_KEY_TTL_MS = 2 * 60 * 60 * 1000;
const RENEWAL_MARGIN_MS = 5 * 60 * 1000;

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

  const response = await fetch(`${apiUrl}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
    cache: "no-store",
  });

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

  const response = await fetch(url, {
    ...init,
    headers: {
      "X-API-KEY": apiKey,
      "Content-Type": "application/json",
      ...init.headers,
    },
    cache: "no-store",
  });

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

export async function getTransactions(
  accountId: string,
  options: { from?: string; to?: string; pageSize?: number } = {},
): Promise<Transaction[]> {
  const pageSize = options.pageSize ?? 500;
  const collected: Transaction[] = [];
  let page = 1;

  // A Pluggy pagina transacoes. Buscamos todas as paginas porque o dashboard
  // agrega o periodo inteiro; um mes de extrato cabe folgado em poucas paginas.
  for (;;) {
    const body = await request<Paginated<Transaction>>("/transactions", {
      query: { accountId, from: options.from, to: options.to, pageSize, page },
    });

    const results = body.results ?? [];
    collected.push(...results);

    const totalPages = body.totalPages ?? 1;
    if (page >= totalPages || results.length === 0) break;
    page += 1;
  }

  return collected;
}

export async function deleteItem(itemId: string): Promise<void> {
  await request<unknown>(`/items/${itemId}`, { method: "DELETE" });
}
