import { extractCounterparty, type PaymentData } from "@/lib/finance/counterparties";
import { localDay } from "@/lib/finance/dates";
import { extractDetails } from "@/lib/finance/details";
import { normalizeAmount } from "@/lib/finance/money";
import type { Account, Investment, Item, Transaction } from "@/lib/pluggy/types";
import type { Db } from "@/lib/db/adapter";
import {
  markSync,
  substituirPosicoes,
  upsertAccount,
  upsertConnection,
  upsertTransactions,
} from "@/lib/db/repository";

/**
 * Sincronizacao Pluggy → banco.
 *
 * Recebe o cliente da Pluggy por parametro em vez de importa-lo: assim o teste
 * exercita a orquestracao inteira — normalizacao de sinal, fuso, contraparte,
 * isolamento de falhas — sem rede.
 */
export interface PluggyGateway {
  getItem(itemId: string): Promise<Item>;
  getAccounts(itemId: string): Promise<Account[]>;
  getTransactions(
    accountId: string,
    options: { from?: string; to?: string },
  ): Promise<(Transaction & { paymentData?: PaymentData | null })[]>;
  /**
   * Opcional: nem todo conector expoe investimento, e o gateway falso dos
   * testes nao precisa implementar o que nao esta testando.
   */
  getInvestments?(itemId: string): Promise<Investment[]>;
}

export interface SyncOptions {
  from: string;
  to: string;
}

export interface SyncResult {
  itemId: string;
  connectorName: string;
  accounts: number;
  transactions: number;
  /** Posicoes de investimento gravadas. Zero quando o banco nao expoe. */
  investments: number;
  error?: string;
}

/**
 * Uma conexao de cada vez, com falha isolada.
 *
 * Um banco fora do ar nao pode impedir que os outros sejam sincronizados — e o
 * erro fica registrado na conexao, para a tela poder dizer que aquele dado esta
 * velho em vez de apresenta-lo como atual.
 */
/** Nome ja registrado para a conexao, usado quando o item esta ilegivel agora. */
async function nomeConhecido(db: Db, itemId: string): Promise<string | null> {
  const linhas = await db.query<{ connector_name: string }>(
    "SELECT connector_name FROM connections WHERE item_id = $1",
    [itemId],
  );
  return linhas[0]?.connector_name ?? null;
}

export async function syncConnection(
  db: Db,
  pluggy: PluggyGateway,
  itemId: string,
  periodo: SyncOptions,
): Promise<SyncResult> {
  let connectorName = "(desconhecido)";

  try {
    // A conexao precisa existir antes de qualquer conta, porque contas
    // referenciam item_id — e ha conexoes reais que respondem 404 no item e
    // ainda assim entregam contas.
    const item = await pluggy.getItem(itemId).catch(() => null);
    connectorName = item?.connector.name ?? (await nomeConhecido(db, itemId)) ?? connectorName;

    await upsertConnection(db, {
      itemId,
      connectorId: item?.connector.id ?? null,
      connectorName,
      status: item?.status ?? null,
    });

    const contas = await pluggy.getAccounts(itemId);
    let totalTransacoes = 0;

    for (const conta of contas) {
      const accountId = await upsertAccount(db, {
        itemId,
        pluggyAccountId: conta.id,
        connectorName,
        type: conta.type,
        subtype: conta.subtype,
        // Identidade pelo nome cru; exibicao pelo marketingName quando houver.
        identityName: conta.name,
        name: conta.marketingName || conta.name,
        number: conta.number,
        balance: conta.balance,
        currency: conta.currencyCode,
      });

      const brutas = await pluggy.getTransactions(conta.id, periodo);

      const preparadas = brutas.map((bruta) => {
        // O sinal e normalizado antes de qualquer leitura do valor: a
        // identificacao da contraparte usa a direcao para saber qual lado do
        // pagamento e o usuario.
        const amount = normalizeAmount(bruta.amount, conta.type);
        const contraparte = extractCounterparty(bruta.paymentData, amount, bruta.description);
        const detalhes = extractDetails({ ...bruta, amount });

        return {
          id: bruta.id,
          accountId,
          postedAt: bruta.date,
          localDay: localDay(bruta.date),
          amount,
          currency: bruta.currencyCode,
          category: bruta.category ?? null,
          categoryId: bruta.categoryId ?? null,
          description: bruta.description,
          counterpartyKey: contraparte?.key ?? null,
          counterpartyName: contraparte?.name ?? null,
          counterpartyDocument: contraparte?.document ?? null,
          counterpartySelf: contraparte?.self ?? false,
          details: detalhes.length ? detalhes : null,
        };
      });

      totalTransacoes += await upsertTransactions(db, preparadas);
    }

    // A carteira e uma fotografia, nao um lancamento: nao depende do periodo
    // sincronizado e e reescrita por inteiro a cada passagem.
    //
    // Falha aqui NAO derruba a sincronizacao: extrato e o essencial, carteira e
    // o extra, e perder o mes inteiro porque a corretora nao respondeu seria
    // trocar o certo pelo duvidoso.
    let totalPosicoes = 0;
    try {
      const posicoes = (await pluggy.getInvestments?.(itemId)) ?? [];

      totalPosicoes = await substituirPosicoes(
        db,
        itemId,
        posicoes.map((posicao) => ({
          id: posicao.id,
          itemId,
          // O nome do conector, e nao `institution.name` da posicao: uma
          // conexao e uma instituicao, e e assim que o resto do app a chama —
          // nas contas, em Conexoes, na cor do grafico. O nome que vem dentro
          // da posicao varia de linha para linha ("BTG Pactual" numa,
          // "BTGPactual" noutra), e duas grafias do mesmo banco partiriam o
          // total dele em dois sem nunca dar erro.
          institution: connectorName,
          type: posicao.type,
          subtype: posicao.subtype ?? null,
          name: posicao.name ?? null,
          issuer: posicao.issuer ?? null,
          balance: posicao.balance ?? null,
          amount: posicao.amount ?? null,
          profit: posicao.amountProfit ?? null,
          annualRate: posicao.annualRate ?? null,
          dueDate: posicao.dueDate ? String(posicao.dueDate).slice(0, 10) : null,
          currency: posicao.currencyCode ?? null,
          status: posicao.status ?? null,
        })),
      );
    } catch {
      totalPosicoes = 0;
    }

    await markSync(db, itemId, null);
    return {
      itemId,
      connectorName,
      accounts: contas.length,
      transactions: totalTransacoes,
      investments: totalPosicoes,
    };
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Erro desconhecido";

    // A conexao pode nem existir no banco ainda se a primeira chamada falhou;
    // registramos o erro assim mesmo para a tela ter o que mostrar.
    await upsertConnection(db, { itemId, connectorName }).catch(() => {});
    await markSync(db, itemId, mensagem).catch(() => {});

    return {
      itemId,
      connectorName,
      accounts: 0,
      transactions: 0,
      investments: 0,
      error: mensagem,
    };
  }
}

export async function syncAll(
  db: Db,
  pluggy: PluggyGateway,
  itemIds: string[],
  periodo: SyncOptions,
): Promise<SyncResult[]> {
  const resultados: SyncResult[] = [];

  // Em serie de proposito: a Pluggy limita chamadas por minuto, e um paralelismo
  // ganancioso aqui trocaria alguns segundos por erros de limite.
  for (const itemId of itemIds) {
    resultados.push(await syncConnection(db, pluggy, itemId, periodo));
  }

  return resultados;
}
