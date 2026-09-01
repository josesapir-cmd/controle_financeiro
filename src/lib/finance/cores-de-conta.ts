/**
 * Cor de cada instituicao.
 *
 * Aqui a cor NAO e codificacao de dado, e identidade: o roxo do Nubank e o
 * laranja do Inter sao os mesmos que a pessoa ve no aplicativo do banco, entao
 * reconhecer a bolinha na linha do tempo nao exige consultar legenda nenhuma.
 * Ainda assim a cor nunca anda sozinha — o nome da conta aparece no botao do
 * filtro, que funciona como legenda, e no rotulo de cada ponto.
 *
 * Instituicao desconhecida nao fica cinza: ganha uma matiz derivada do proprio
 * nome, sempre a mesma, com claridade e croma fixos. Assim um banco novo entra
 * com cor propria sem passar por aqui, e sem sair mais claro ou mais escuro que
 * os outros.
 */

interface Marca {
  /** Trecho ja normalizado que identifica a instituicao. */
  chave: string;
  cor: string;
}

/**
 * Ordem importa: o trecho mais especifico vem antes. "itau personnalite" tem de
 * ser testado antes de "itau", senao o Personnalite herda o laranja do Itau.
 */
const MARCAS: Marca[] = [
  { chave: "itau personnalite", cor: "#002b5c" },
  { chave: "personnalite", cor: "#002b5c" },
  { chave: "nu pagamentos", cor: "#820ad1" },
  { chave: "nubank", cor: "#820ad1" },
  { chave: "banco inter", cor: "#ff7a00" },
  { chave: "inter", cor: "#ff7a00" },
  { chave: "btg", cor: "#00a0df" },
  { chave: "itau", cor: "#ec7000" },
  { chave: "bradesco", cor: "#cc092f" },
  { chave: "santander", cor: "#ec0000" },
  { chave: "banco do brasil", cor: "#0033a0" },
  { chave: "caixa", cor: "#0070af" },
  { chave: "c6", cor: "#2b2b2b" },
  { chave: "safra", cor: "#0b3d2c" },
  { chave: "sicredi", cor: "#3fa110" },
  { chave: "sicoob", cor: "#00655a" },
  { chave: "mercado pago", cor: "#00b1ea" },
  { chave: "picpay", cor: "#11c76f" },
  { chave: "pagbank", cor: "#14aa4b" },
  { chave: "pagseguro", cor: "#14aa4b" },
  { chave: "neon", cor: "#00a5f0" },
  { chave: "will", cor: "#d9a400" },
  { chave: "pan", cor: "#0f52ba" },
  { chave: "porto", cor: "#0033a1" },
  { chave: "xp", cor: "#6b7280" },
];

function normalizar(nome: string): string {
  return nome
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Soma estavel dos caracteres: mesma entrada, mesma matiz, em qualquer maquina. */
function matizDoNome(nome: string): number {
  let acumulado = 0;
  for (let i = 0; i < nome.length; i += 1) {
    acumulado = (acumulado * 31 + nome.charCodeAt(i)) % 360;
  }
  return acumulado;
}

export function corDaInstituicao(connectorName: string): string {
  const nome = normalizar(connectorName);
  if (!nome) return "oklch(0.55 0.02 250)";

  const marca = MARCAS.find((m) => nome.includes(m.chave));
  if (marca) return marca.cor;

  return `oklch(0.55 0.15 ${matizDoNome(nome)})`;
}

/**
 * Cor por id de conta, para quem tem a transacao em maos e so conhece o
 * `accountId`. Contas do mesmo banco compartilham a cor de proposito: o filtro
 * tambem agrupa por instituicao, entao as duas telas contam a mesma historia.
 */
export function coresPorConta(
  contas: { id: string; connectorName: string }[],
): Record<string, string> {
  const mapa: Record<string, string> = {};
  for (const conta of contas) mapa[conta.id] = corDaInstituicao(conta.connectorName);
  return mapa;
}
