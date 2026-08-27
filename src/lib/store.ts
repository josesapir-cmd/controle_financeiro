import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * A API da Pluggy nao expoe rota de listagem de items — so `GET /items/{id}`.
 * Entao a aplicacao precisa guardar por conta propria os ids das conexoes que
 * acompanha. Um JSON em disco basta para uso pessoal e evita subir um banco.
 *
 * Guardamos apenas ids. Nada de saldo, extrato ou dado pessoal em disco.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const ITEMS_FILE = path.join(DATA_DIR, "items.json");

interface StoredItems {
  itemIds: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_ANYWHERE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

export function isValidItemId(value: string): boolean {
  return UUID.test(value.trim());
}

/**
 * Aceita tanto o UUID puro quanto a URL da conexao no Meu Pluggy
 * (meu.pluggy.ai/connections/<itemId>), que e o que o usuario tem a mao ao
 * copiar da barra de enderecos. Devolve null se nao houver UUID no texto.
 */
export function parseItemId(input: string): string | null {
  const match = input.trim().match(UUID_ANYWHERE);
  return match ? match[0].toLowerCase() : null;
}

export type ItemSource = "env" | "file";

export interface StoredItem {
  id: string;
  source: ItemSource;
}

async function read(): Promise<StoredItems> {
  try {
    const content = await readFile(ITEMS_FILE, "utf8");
    const parsed = JSON.parse(content) as unknown;
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as StoredItems).itemIds)) {
      return { itemIds: (parsed as StoredItems).itemIds.filter(isValidItemId) };
    }
  } catch {
    // Arquivo ausente ou corrompido: tratamos como lista vazia em vez de quebrar
    // a aplicacao, ja que o usuario pode recadastrar os ids pela interface.
  }
  return { itemIds: [] };
}

async function write(data: StoredItems): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(ITEMS_FILE, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

export async function listItemIds(): Promise<string[]> {
  const fromEnv = (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(isValidItemId);

  const stored = await read();

  // Uniao entre o que veio do ambiente e o que foi cadastrado pela interface,
  // sem duplicar, preservando a ordem de cadastro.
  return [...new Set([...fromEnv, ...stored.itemIds])];
}

/**
 * Lista as conexoes indicando de onde cada uma veio. As definidas em
 * PLUGGY_ITEM_IDS nao podem ser removidas pela interface — o arquivo nao manda
 * no ambiente — e a tela precisa dizer isso em vez de oferecer um botao que
 * nao funciona.
 */
export async function listItems(): Promise<StoredItem[]> {
  const fromEnv = (process.env.PLUGGY_ITEM_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(isValidItemId);

  const stored = await read();
  const vistos = new Set<string>();
  const items: StoredItem[] = [];

  for (const id of fromEnv) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    items.push({ id, source: "env" });
  }
  for (const id of stored.itemIds) {
    if (vistos.has(id)) continue;
    vistos.add(id);
    items.push({ id, source: "file" });
  }

  return items;
}

export async function addItemId(input: string): Promise<void> {
  const itemId = parseItemId(input);
  if (!itemId) {
    throw new Error(
      "Nao encontrei um itemId no que voce colou. Cole a URL da conexao no Meu Pluggy ou o UUID.",
    );
  }

  const stored = await read();
  if (!stored.itemIds.includes(itemId)) {
    stored.itemIds.push(itemId);
    await write(stored);
  }
}

export async function removeItemId(itemId: string): Promise<void> {
  const stored = await read();
  await write({ itemIds: stored.itemIds.filter((id) => id !== itemId) });
}
