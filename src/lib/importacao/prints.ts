import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { validar, type LinhaBruta, type Procedencia, type Validacao } from "./linhas";

/**
 * Leitura de prints da tela de saldo compartilhado do Nubank.
 *
 * O saldo compartilhado nao existe no Open Finance: a conta corrente mostra
 * apenas a transferencia mensal com o valor cheio, e o gasto real acontece do
 * outro lado. Como esse dinheiro e do usuario, ele entra por foto da tela ate
 * que o arquivo categorizado do Poupa.ai seja carregado.
 *
 * A leitura nunca grava direto: devolve linhas para conferencia. Numero lido de
 * imagem erra, e um gasto errado no painel e pior do que um gasto ausente.
 */

const MODELO = "claude-opus-5";

export interface Imagem {
  midia: string;
  /** Conteudo da imagem em base64, sem o prefixo `data:`. */
  base64: string;
}

const ESQUEMA = {
  type: "object",
  properties: {
    linhas: {
      type: "array",
      items: {
        type: "object",
        properties: {
          data: {
            type: "string",
            description: "Data do lancamento em AAAA-MM-DD, ja resolvida.",
          },
          descricao: {
            type: "string",
            description: "Texto do lancamento como aparece na tela, sem abreviar.",
          },
          valor: {
            type: "number",
            description: "Valor absoluto em reais, sempre positivo. Use ponto decimal.",
          },
          tipo: {
            type: "string",
            enum: ["despesa", "entrada"],
            description: "despesa quando sai do saldo, entrada quando entra nele.",
          },
          confianca: {
            type: "string",
            enum: ["alta", "media", "baixa"],
            description: "Quao legivel estava a linha na imagem.",
          },
        },
        required: ["data", "descricao", "valor", "tipo", "confianca"],
        additionalProperties: false,
      },
    },
    observacao: {
      type: "string",
      description:
        "O que ficou em duvida ou parcialmente visivel. Texto vazio quando nao houver nada a dizer.",
    },
  },
  required: ["linhas", "observacao"],
  additionalProperties: false,
} as const;

function instrucoes(hoje: string): string {
  return [
    "Voce esta lendo capturas de tela do extrato do saldo compartilhado do app do Nubank.",
    "Extraia TODOS os lancamentos visiveis, um por linha da tela, na ordem em que aparecem.",
    "",
    `Hoje e ${hoje} (fuso de Brasilia). A tela agrupa por data e costuma omitir o ano:`,
    "resolva cada data para a ocorrencia passada mais recente em relacao a hoje, nunca para o futuro.",
    "Traduza 'Hoje' e 'Ontem' para a data correspondente.",
    "",
    "Regras:",
    "- valor sempre positivo; o sentido vai em `tipo`.",
    "- `tipo` = 'despesa' quando o dinheiro sai do saldo compartilhado (pagamentos, compras, boletos),",
    "  'entrada' quando entra (transferencia recebida, estorno, reembolso).",
    "- descricao: o texto do lancamento como esta na tela. Nao invente nem complete nomes.",
    "- linha cortada na borda da imagem, borrada ou com valor parcialmente coberto:",
    "  inclua mesmo assim com confianca 'baixa' e descreva o problema em `observacao`.",
    "- nao repita a mesma linha se ela aparecer em duas imagens que se sobrepoem.",
    "- ignore saldos, totais, titulos de secao e qualquer coisa que nao seja um lancamento.",
    "",
    "Se nenhuma imagem for um extrato do saldo compartilhado, devolva `linhas` vazio e explique em `observacao`.",
  ].join("\n");
}

export interface Leitura extends Validacao {
  observacao: string;
}

/** Cliente injetavel para que os testes nao precisem de rede nem de chave. */
export interface ClienteDeLeitura {
  ler(imagens: Imagem[], hoje: string): Promise<{ linhas: LinhaBruta[]; observacao: string }>;
}

export function clienteAnthropic(apiKey = process.env.ANTHROPIC_API_KEY): ClienteDeLeitura {
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY nao configurada. Sem ela nao da para ler os prints do saldo compartilhado.",
    );
  }

  const client = new Anthropic({ apiKey });

  return {
    async ler(imagens, hoje) {
      // Streaming porque a requisicao carrega varias imagens: sem ele, uma
      // leitura demorada bate no tempo limite da conexao em vez de terminar.
      const resposta = await client.messages
        .stream({
          model: MODELO,
          max_tokens: 8000,
          output_config: {
            effort: "medium",
            format: { type: "json_schema", schema: ESQUEMA },
          },
          messages: [
            {
              role: "user",
              content: [
                ...imagens.map((imagem) => ({
                  type: "image" as const,
                  source: {
                    type: "base64" as const,
                    media_type: imagem.midia as "image/png",
                    data: imagem.base64,
                  },
                })),
                { type: "text" as const, text: instrucoes(hoje) },
              ],
            },
          ],
        })
        .finalMessage();

      const texto = resposta.content
        .filter((bloco): bloco is Anthropic.TextBlock => bloco.type === "text")
        .map((bloco) => bloco.text)
        .join("");

      if (!texto.trim()) {
        throw new Error("O modelo nao devolveu nenhuma leitura para as imagens enviadas.");
      }

      let dados: unknown;
      try {
        dados = JSON.parse(texto);
      } catch {
        throw new Error("Resposta do modelo nao veio em JSON. Tente enviar os prints novamente.");
      }

      const corpo = (dados ?? {}) as { linhas?: unknown; observacao?: unknown };
      return {
        linhas: Array.isArray(corpo.linhas) ? (corpo.linhas as LinhaBruta[]) : [],
        observacao: typeof corpo.observacao === "string" ? corpo.observacao : "",
      };
    },
  };
}

/** Le um bloco da fila. Quem controla a fila e a tela; aqui e uma chamada so. */
export async function lerPrints(
  imagens: Imagem[],
  hoje: string,
  procedencia: Procedencia,
  cliente: ClienteDeLeitura = clienteAnthropic(),
): Promise<Leitura> {
  if (imagens.length === 0) throw new Error("Nenhuma imagem enviada.");

  const bruto = await cliente.ler(imagens, hoje);
  return { ...validar(bruto.linhas, procedencia), observacao: bruto.observacao };
}
