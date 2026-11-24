/**
 * O que pode ser anexado a um lancamento.
 *
 * Fora de qualquer modulo de servidor porque a tela de envio, que roda no
 * navegador, precisa dos mesmos limites — e numeros duplicados divergem.
 *
 * So imagem e PDF: e o que um recibo, uma nota ou um comprovante sao. A lista
 * fechada tambem e defesa: o anexo e servido de volta pelo app, e um HTML ou
 * SVG enviado como "anexo" seria uma pagina rodando no dominio do app.
 */

/**
 * Quatro megas por arquivo.
 *
 * Nao e gosto: a Vercel recusa corpo de requisicao acima de 4,5 MB antes de
 * o codigo do app rodar, e o erro que volta e generico. Barrar aqui, com o
 * tamanho na mensagem, e o que deixa a pessoa saber o que fazer.
 */
export const ANEXO_TAMANHO_MAXIMO = 4 * 1024 * 1024;

const TIPOS = {
  "application/pdf": "PDF",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/webp": "WebP",
  "image/gif": "GIF",
  "image/heic": "HEIC",
  "image/heif": "HEIF",
} as const;

export type TipoDeAnexo = keyof typeof TIPOS;

export const ANEXO_ACCEPT = Object.keys(TIPOS).join(",");

export function tipoDeAnexoAceito(tipo: string): tipo is TipoDeAnexo {
  return Object.hasOwn(TIPOS, tipo);
}

/**
 * Os primeiros bytes batem com o tipo declarado.
 *
 * O tipo vem do navegador, que o deduz da extensao — renomear `pagina.html`
 * para `recibo.pdf` passaria. A assinatura do arquivo nao se renomeia.
 */
export function assinaturaConfere(tipo: TipoDeAnexo, bytes: Uint8Array): boolean {
  const ascii = (inicio: number, texto: string) =>
    [...texto].every((c, i) => bytes[inicio + i] === c.charCodeAt(0));

  switch (tipo) {
    case "application/pdf":
      return ascii(0, "%PDF-");
    case "image/png":
      return bytes[0] === 0x89 && ascii(1, "PNG");
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return ascii(0, "GIF8");
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "image/heic":
    case "image/heif":
      // ISO BMFF: tamanho da caixa nos quatro primeiros bytes, depois "ftyp".
      return ascii(4, "ftyp");
  }
}

/** Abrir no navegador ou baixar. PDF e imagem abrem; o resto nem entra. */
export function abreNoNavegador(tipo: string): boolean {
  return tipo === "application/pdf" || (tipo.startsWith("image/") && !tipo.includes("hei"));
}

export function tamanhoLegivel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}
