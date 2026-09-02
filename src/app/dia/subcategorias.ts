/**
 * Sugestao de subcategoria por texto digitado.
 *
 * Fora do componente porque e decisao, nao desenho: qual nome o enter vai
 * escolher. Errar aqui grava o gasto na subcategoria errada.
 */

function comparavel(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * As subcategorias que combinam com o que foi digitado, as que comecam com o
 * texto primeiro.
 *
 * Comecar com o texto vale mais que conte-lo no meio: quem digita "vi" quer
 * "Viagem", nao "Servico de vidro". Campo vazio mostra todas — e a lista do que
 * existe, que e o que se quer ver antes de digitar qualquer coisa.
 */
export function filtrarSubcategorias(
  centros: { name: string }[],
  digitado: string,
): string[] {
  const alvo = comparavel(digitado);
  const nomes = centros.map((c) => c.name);
  if (!alvo) return nomes;

  const comeca = nomes.filter((nome) => comparavel(nome).startsWith(alvo));
  const contem = nomes.filter(
    (nome) => !comeca.includes(nome) && comparavel(nome).includes(alvo),
  );

  return [...comeca, ...contem];
}

/**
 * O nome que o campo completa sozinho enquanto se digita.
 *
 * So prefixo, nunca "contem": completar "vi" para "Servico de vidro" trocaria o
 * que a pessoa esta escrevendo por outra coisa no meio da digitacao. Quem quer
 * um nome que so contem o texto chega nele pelas setas.
 *
 * O nome completo vence o digitado inclusive no acento: digitar "fe" completa
 * para "Ferias" com o acento que o cadastro tem, porque e aquele registro que
 * vai ser usado, nao um homonimo sem acento.
 */
export function completarSubcategoria(
  centros: { name: string }[],
  digitado: string,
): string | null {
  const alvo = comparavel(digitado);
  if (!alvo) return null;

  const achado = centros.find((centro) => {
    const nome = comparavel(centro.name);
    return nome.startsWith(alvo) && nome.length > alvo.length;
  });

  return achado?.name ?? null;
}
