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

export function isValidItemId(value: string): boolean {
  return UUID.test(value.trim());
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

export async function addItemId(itemId: string): Promise<string[]> {
  const trimmed = itemId.trim();
  if (!isValidItemId(trimmed)) {
    throw new Error("itemId precisa ser um UUID.");
  }

  const stored = await read();
  if (!stored.itemIds.includes(trimmed)) {
    stored.itemIds.push(trimmed);
    await write(stored);
  }
  return listItemIds();
}

export async function removeItemId(itemId: string): Promise<string[]> {
  const stored = await read();
  await write({ itemIds: stored.itemIds.filter((id) => id !== itemId) });
  return listItemIds();
}
