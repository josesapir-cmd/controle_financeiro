import type { Transaction } from "@/lib/pluggy/types";

/**
 * Como o lancamento aparece escrito na tela.
 *
 * A descricao que vem do banco e escrita para o extrato, nao para quem esta
 * conferindo o dia: "Transferencia enviada pelo Pix" ocupa a linha inteira sem
 * dizer a unica coisa que importa, que e para quem o dinheiro foi. Quando
 * sabemos o meio e a contraparte, a linha vira "PIX para Fulano".
 *
 * Fora esse caso, a descricao original passa intacta. Reescrever o que nao se
 * entendeu direito seria perder informacao — o extrato e a fonte, e ele nem
 * sempre segue padrao.
 */

/** So aparece no rotulo o que reconhecemos com certeza. */
const MEIOS: { chave: string; nome: string }[] = [
  { chave: "pix", nome: "PIX" },
  { chave: "ted", nome: "TED" },
  { chave: "doc", nome: "DOC" },
  { chave: "boleto", nome: "Boleto" },
];

function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Meio de pagamento, quando da para afirmar.
 *
 * Tres fontes, da mais confiavel para a menos: o campo `paymentMethod` que a
 * Pluggy manda em paymentData (ja virou o detalhe "Meio"), a categoria dela, e
 * so entao a descricao. A descricao entra por ultimo porque "compra no debito
 * para pagar o Pix da faculdade" tambem casa com a palavra.
 */
export function meioDePagamento(transaction: Transaction): string | null {
  const detalhe = transaction.details?.find((d) => normalizar(d.label) === "meio");
  if (detalhe) {
    const achado = MEIOS.find((m) => normalizar(detalhe.value) === m.chave);
    if (achado) return achado.nome;
    // Meio conhecido pela Pluggy que nao esta na lista: nao inventamos rotulo.
    return null;
  }

  const categoria = normalizar(transaction.category ?? "");
  const porCategoria = MEIOS.find((m) => categoria === `transfer - ${m.chave}`);
  if (porCategoria) return porCategoria.nome;

  const descricao = normalizar(
    `${transaction.description ?? ""} ${transaction.descriptionRaw ?? ""}`,
  );
  const porDescricao = MEIOS.find((m) => new RegExp(`\\b${m.chave}\\b`).test(descricao));
  return porDescricao?.nome ?? null;
}

/**
 * Nome da contraparte ja no rotulo, entao a lista de detalhes nao precisa
 * repeti-lo. Comparacao sem acento e sem caixa porque o extrato costuma vir em
 * caixa alta e o apelido, nao.
 */
export function rotuloContemNome(rotulo: string, nome: string | null | undefined): boolean {
  if (!nome) return false;
  return normalizar(rotulo).includes(normalizar(nome));
}

/**
 * @param nome Apelido, se houver; senao o nome que veio do extrato.
 */
export function rotuloDoLancamento(
  transaction: Transaction,
  nome?: string | null,
): string {
  const descricao = transaction.description?.trim() || "Lancamento";

  const limpo = nome?.trim();
  if (!limpo) return descricao;

  const meio = meioDePagamento(transaction);
  if (!meio) return descricao;

  // Saida vai "para", entrada vem "de". A preposicao e a unica coisa que separa
  // "recebi de Fulano" de "paguei Fulano" numa linha so.
  return transaction.amount < 0 ? `${meio} para ${limpo}` : `${meio} de ${limpo}`;
}
