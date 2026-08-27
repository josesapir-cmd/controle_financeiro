import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CounterpartyRegistry } from "@/lib/finance/counterparties";

/**
 * Cadastro de contrapartes: categoria e apelido escolhidos pelo usuario.
 *
 * Fica em disco, fora do controle de versao, porque guarda nomes de pessoas e
 * empresas com quem o usuario transaciona. A chave e o documento (ou o nome
 * normalizado, quando nao ha documento) — nunca gravamos o extrato em si.
 */

const DATA_DIR = path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "counterparties.json");

export async function readRegistry(): Promise<CounterpartyRegistry> {
  try {
    const conteudo = await readFile(FILE, "utf8");
    const parsed = JSON.parse(conteudo) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as CounterpartyRegistry;
    }
  } catch {
    // Arquivo ausente ou corrompido: cadastro vazio e melhor que pagina quebrada,
    // e o usuario pode recadastrar pela interface.
  }
  return {};
}

async function write(registry: CounterpartyRegistry): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(FILE, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export async function setCounterparty(
  key: string,
  values: { category?: string; subcategory?: string; alias?: string },
): Promise<void> {
  const chave = key.trim();
  if (!chave) throw new Error("Contraparte sem identificacao.");

  const registry = await readRegistry();
  const atual = registry[chave] ?? {};

  const category = values.category?.trim();
  const subcategory = values.subcategory?.trim();
  const alias = values.alias?.trim();

  const proximo = {
    ...atual,
    ...(values.category !== undefined ? { category: category || undefined } : {}),
    ...(values.subcategory !== undefined ? { subcategory: subcategory || undefined } : {}),
    ...(values.alias !== undefined ? { alias: alias || undefined } : {}),
  };

  // Entrada vazia nao precisa ocupar espaco no arquivo.
  if (!proximo.category && !proximo.subcategory && !proximo.alias) delete registry[chave];
  else registry[chave] = proximo;

  await write(registry);
}

/**
 * Categorias e subcategorias ja usadas, para sugerir em vez de exigir digitacao
 * — e, com isso, evitar que a mesma categoria vire tres variacoes de grafia.
 */
export async function listTaxonomy(): Promise<{ categories: string[]; subcategories: string[] }> {
  const registry = await readRegistry();
  const categorias = new Set<string>();
  const subcategorias = new Set<string>();

  for (const entrada of Object.values(registry)) {
    if (entrada.category) categorias.add(entrada.category);
    if (entrada.subcategory) subcategorias.add(entrada.subcategory);
  }

  const ordenar = (a: string, b: string) => a.localeCompare(b, "pt-BR");
  return {
    categories: [...categorias].sort(ordenar),
    subcategories: [...subcategorias].sort(ordenar),
  };
}
