import { normalizeName } from "./counterparties";

/**
 * Casamento de nome para a busca de contraparte.
 *
 * Fora do servico porque e a parte que decide o que aparece e o que some, e
 * errar aqui e invisivel: um resultado a menos parece "nao existe", nao
 * "procurei mal".
 */

/**
 * Se o alvo contem TODOS os pedacos do termo, em qualquer ordem.
 *
 * Por pedacos, e nao pela frase inteira: quem digita "silva jose" esta
 * procurando "JOSE MANUEL SILVA SAPIR", e exigir a ordem exata devolveria
 * nada. Ignora acento e caixa dos dois lados, porque ninguem digita acento
 * numa caixa de busca.
 */
export function casaComBusca(alvo: string | null | undefined, termo: string): boolean {
  const pedacos = normalizeName(termo).split(" ").filter(Boolean);
  if (pedacos.length === 0) return false;

  const normalizado = normalizeName(alvo);
  return pedacos.every((pedaco) => normalizado.includes(pedaco));
}

/**
 * Casa contra qualquer um dos nomes que a contraparte tem.
 *
 * Apelido e nome oficial sao coisas diferentes e a pessoa pode lembrar de
 * qualquer um dos dois: procurar so pelo que a tela exibe esconderia a
 * contraparte de quem lembrou do outro.
 */
export function contraparteCasa(
  contraparte: { name?: string; officialName?: string; alias?: string },
  termo: string,
): boolean {
  return (
    casaComBusca(contraparte.name, termo) ||
    casaComBusca(contraparte.officialName, termo) ||
    casaComBusca(contraparte.alias, termo)
  );
}

/**
 * Uma linha do autocomplete: nome e volume, sem o historico.
 *
 * Mora aqui, e nao no servico, porque a caixa de busca e componente de cliente
 * e o servico e `server-only` — importar a constante de la arrastaria o modulo
 * inteiro para o bundle do navegador.
 */
export interface SugestaoDeContraparte {
  key: string;
  nome: string;
  nomeOficial: string | null;
  apelido: string | null;
  contagem: number;
}

/**
 * Minimo de caracteres antes de sugerir.
 *
 * Um digito casa com quase toda a carteira, entao a primeira letra nao carrega
 * informacao nenhuma: sugerir a partir dela devolveria a lista inteira cortada
 * no limite, que e pior que nao sugerir.
 */
export const MINIMO_DO_AUTOCOMPLETE = 2;
