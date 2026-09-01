import { fingerprint } from "@/lib/crypto";
import { chaveDeComparacao } from "./linhas";

/**
 * Prints de lista de pedidos: Amazon, Mercado Livre, assinaturas da Apple.
 *
 * Sao outra coisa que os prints do saldo compartilhado, e o destino e outro. O
 * saldo compartilhado nao existe no Open Finance, entao aquelas linhas VIRAM
 * lancamento. Aqui a cobranca ja chegou pelo Open Finance — so chegou como
 * "AMAZON BR" e mais nada. O que falta e o produto, e e isso que estes prints
 * trazem. Por isso nada aqui cria lancamento: cada linha lida procura a
 * cobranca que ja existe e se gruda nela.
 *
 * A associacao nunca e adivinhada por semelhanca de texto. Exige valor igual ao
 * centavo, data dentro de uma janela e o nome da loja aparecendo na cobranca —
 * as tres coisas. Uma associacao errada renomeia um gasto para um produto que
 * nao foi comprado, o que e pior do que gasto nenhum associado.
 */

/** Pedido como o modelo devolve, ainda sem validar. */
export interface PedidoBruto {
  loja?: unknown;
  produto?: unknown;
  data?: unknown;
  valor?: unknown;
  pedido?: unknown;
  confianca?: unknown;
}

export type Confianca = "alta" | "media" | "baixa";

export interface Pedido {
  /** Identidade estavel do produto lido, para nao gravar duas vezes. */
  id: string;
  /** Nome da loja como o modelo leu. */
  loja: string;
  produto: string;
  /** AAAA-MM-DD. Data do pedido, que nem sempre e a da cobranca. */
  dia: string;
  /** Valor absoluto, sempre positivo. */
  valor: number;
  /** Numero do pedido, quando a tela mostra. */
  referencia: string | null;
  confianca: Confianca;
  envio: number;
  arquivos: string[];
}

export interface PedidoRejeitado {
  motivo: string;
  original: PedidoBruto;
}

/**
 * Lojas que sabemos reconhecer numa descricao de cartao.
 *
 * A lista existe porque o nome na fatura raramente e o nome da loja: a Apple
 * cobra como "APPLE.COM/BILL", o Mercado Livre as vezes como "MERCADOPAGO". Sem
 * o mapa, o casamento erraria para o lado seguro e nao acharia nada.
 */
const LOJAS: { nome: string; termos: string[] }[] = [
  { nome: "Amazon", termos: ["amazon", "amzn"] },
  {
    nome: "Mercado Livre",
    termos: ["mercado livre", "mercadolivre", "mercadolibre", "mercado pago", "mercadopago", "meli"],
  },
  { nome: "Apple", termos: ["apple", "itunes", "app store", "appstore"] },
  { nome: "Google", termos: ["google", "gplay"] },
  { nome: "Netflix", termos: ["netflix"] },
  { nome: "Spotify", termos: ["spotify"] },
  { nome: "Magazine Luiza", termos: ["magazine luiza", "magalu"] },
  { nome: "Americanas", termos: ["americanas", "b2w"] },
  { nome: "Shopee", termos: ["shopee"] },
  { nome: "AliExpress", termos: ["aliexpress", "alibaba"] },
];

/**
 * Termos que identificam a loja numa descricao de cobranca.
 *
 * Loja fora do mapa nao fica sem casamento: o proprio nome lido vale como
 * termo. So nao vale nome curto demais — "OI" casaria com meia fatura.
 */
export function termosDaLoja(loja: string): string[] {
  const chave = chaveDeComparacao(loja);
  if (!chave) return [];

  const conhecida = LOJAS.find((l) => l.termos.some((t) => chave.includes(t)));
  if (conhecida) return conhecida.termos;

  return chave.length >= 4 ? [chave] : [];
}

/** Nome de exibicao da loja, normalizado quando a conhecemos. */
export function nomeDaLoja(loja: string): string {
  const chave = chaveDeComparacao(loja);
  const conhecida = LOJAS.find((l) => l.termos.some((t) => chave.includes(t)));
  return conhecida?.nome ?? loja.trim();
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function confianca(valor: unknown): Confianca {
  return valor === "alta" || valor === "media" || valor === "baixa" ? valor : "baixa";
}

export interface ValidacaoDePedidos {
  pedidos: Pedido[];
  rejeitados: PedidoRejeitado[];
}

/**
 * Valida o que o modelo devolveu.
 *
 * Pedido sem loja e recusado de proposito: sem ela nao ha como exigir que a
 * cobranca seja daquela loja, e o casamento passaria a ser so valor e data — o
 * que casaria o livro da Amazon com o almoco de mesmo preco.
 */
export function validarPedidos(
  brutos: PedidoBruto[],
  procedencia: { envio: number; arquivos: string[] },
): ValidacaoDePedidos {
  const pedidos: Pedido[] = [];
  const rejeitados: PedidoRejeitado[] = [];
  const vistos = new Map<string, number>();

  for (const bruto of brutos) {
    const dia = texto(bruto.data);
    const produto = texto(bruto.produto);
    const loja = texto(bruto.loja);
    const valorBruto = typeof bruto.valor === "number" ? bruto.valor : Number(bruto.valor);

    if (!DIA.test(dia)) {
      rejeitados.push({ motivo: "Data ilegivel", original: bruto });
      continue;
    }
    if (!produto) {
      rejeitados.push({ motivo: "Sem nome de produto", original: bruto });
      continue;
    }
    if (!loja) {
      rejeitados.push({ motivo: "Sem loja", original: bruto });
      continue;
    }
    if (!Number.isFinite(valorBruto) || valorBruto <= 0) {
      rejeitados.push({ motivo: "Valor ilegivel", original: bruto });
      continue;
    }

    const valor = Math.round(Math.abs(valorBruto) * 100) / 100;
    // Dois itens iguais no mesmo pedido sao duas linhas, nao uma: a ocorrencia
    // entra na identidade para que a segunda nao apague a primeira.
    const chave = `${dia}|${valor.toFixed(2)}|${chaveDeComparacao(produto)}`;
    const ocorrencia = (vistos.get(chave) ?? 0) + 1;
    vistos.set(chave, ocorrencia);

    pedidos.push({
      id: fingerprint("order-item", `${chave}|${ocorrencia}`),
      loja: nomeDaLoja(loja),
      produto,
      dia,
      valor,
      referencia: texto(bruto.pedido) || null,
      confianca: confianca(bruto.confianca),
      envio: procedencia.envio,
      arquivos: procedencia.arquivos,
    });
  }

  return { pedidos, rejeitados };
}

/** Cobranca ja existente, do jeito que o casamento precisa ve-la. */
export interface Cobranca {
  id: string;
  /** AAAA-MM-DD no fuso local. */
  dia: string;
  /** Negativo para saida, como no resto do app. */
  valor: number;
  descricao: string;
  contraparte?: string | null;
}

export type Certeza = "exata" | "ambigua" | "sem";

export interface Casamento {
  pedido: Pedido;
  /** Cobranca escolhida. Nulo quando ha duvida ou nao ha candidata. */
  cobrancaId: string | null;
  candidatas: Cobranca[];
  certeza: Certeza;
}

/**
 * A cobranca do cartao raramente cai no dia do pedido: a Amazon cobra no envio,
 * que vem dias depois. A janela e larga para frente e curta para tras — para
 * tras so existe para tolerar um dia lido errado na virada do mes.
 */
const DIAS_ANTES = 2;
const DIAS_DEPOIS = 10;
/** Centavos: valor lido de imagem nao tem por que ter erro de arredondamento. */
const TOLERANCIA = 0.005;

function distanciaEmDias(de: string, ate: string): number {
  return Math.round(
    (Date.parse(`${ate}T12:00:00Z`) - Date.parse(`${de}T12:00:00Z`)) / 86400000,
  );
}

function daLoja(cobranca: Cobranca, termos: string[]): boolean {
  if (termos.length === 0) return false;
  const alvo = chaveDeComparacao(`${cobranca.descricao} ${cobranca.contraparte ?? ""}`);
  return termos.some((termo) => alvo.includes(termo));
}

/**
 * Casa cada pedido com a cobranca que ja existe.
 *
 * Uma cobranca so recebe UM produto. Duas compras de mesmo valor na mesma
 * semana existem, e deixar as duas apontarem para a mesma cobranca criaria uma
 * associacao falsa sem ninguem perceber. Quem fica com a cobranca e o pedido
 * mais proximo dela em dias; o outro volta a procurar entre as que sobraram, e
 * se nao houver, sai como "sem".
 */
export function casarPedidos(pedidos: Pedido[], cobrancas: Cobranca[]): Casamento[] {
  const candidatasPorPedido = new Map<string, Cobranca[]>();

  for (const pedido of pedidos) {
    const termos = termosDaLoja(pedido.loja);
    const candidatas = cobrancas
      .filter((cobranca) => {
        if (cobranca.valor >= 0) return false;
        if (Math.abs(Math.abs(cobranca.valor) - pedido.valor) > TOLERANCIA) return false;
        const dias = distanciaEmDias(pedido.dia, cobranca.dia);
        if (dias < -DIAS_ANTES || dias > DIAS_DEPOIS) return false;
        return daLoja(cobranca, termos);
      })
      .sort(
        (a, b) =>
          Math.abs(distanciaEmDias(pedido.dia, a.dia)) -
          Math.abs(distanciaEmDias(pedido.dia, b.dia)),
      );

    candidatasPorPedido.set(pedido.id, candidatas);
  }

  // Ordem de atendimento: quem tem a candidata mais proxima escolhe primeiro.
  const ordem = [...pedidos].sort((a, b) => {
    const da = candidatasPorPedido.get(a.id)?.[0];
    const db = candidatasPorPedido.get(b.id)?.[0];
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return (
      Math.abs(distanciaEmDias(a.dia, da.dia)) - Math.abs(distanciaEmDias(b.dia, db.dia))
    );
  });

  const tomadas = new Set<string>();
  const escolhas = new Map<string, { cobrancaId: string | null; certeza: Certeza }>();

  for (const pedido of ordem) {
    const livres = (candidatasPorPedido.get(pedido.id) ?? []).filter((c) => !tomadas.has(c.id));

    if (livres.length === 0) {
      escolhas.set(pedido.id, { cobrancaId: null, certeza: "sem" });
      continue;
    }

    // Mais de uma cobranca igual na janela: a tela pergunta em vez de escolher.
    if (livres.length > 1) {
      escolhas.set(pedido.id, { cobrancaId: null, certeza: "ambigua" });
      continue;
    }

    tomadas.add(livres[0].id);
    escolhas.set(pedido.id, { cobrancaId: livres[0].id, certeza: "exata" });
  }

  return pedidos.map((pedido) => {
    const escolha = escolhas.get(pedido.id) ?? { cobrancaId: null, certeza: "sem" as Certeza };
    return {
      pedido,
      cobrancaId: escolha.cobrancaId,
      candidatas: (candidatasPorPedido.get(pedido.id) ?? []).filter(
        (c) => c.id === escolha.cobrancaId || !tomadas.has(c.id),
      ),
      certeza: escolha.certeza,
    };
  });
}

/** Junta pedidos de envios diferentes sem repetir o mesmo produto lido duas vezes. */
export function mesclarPedidos(anteriores: Pedido[], novos: Pedido[]): Pedido[] {
  const porId = new Map(anteriores.map((p) => [p.id, p]));
  for (const novo of novos) if (!porId.has(novo.id)) porId.set(novo.id, novo);
  return [...porId.values()];
}
