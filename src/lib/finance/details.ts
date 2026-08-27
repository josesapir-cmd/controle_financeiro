/**
 * Extracao dos detalhes de uma transacao para exibicao.
 *
 * A sanitizacao original descartava o bloco paymentData inteiro por causa do CPF
 * do proprio usuario. Isso jogou fora junto o meio de pagamento, o
 * estabelecimento, os dados do cartao e os identificadores de contrato — que sao
 * exatamente o que permite reconhecer um lancamento e separar, por exemplo, duas
 * parcelas de credito imobiliario de contratos diferentes.
 *
 * Aqui removemos apenas o documento do lado que e o proprio usuario e
 * preservamos o resto, com rotulos legiveis.
 */

export interface Detail {
  label: string;
  value: string;
}

const METODOS: Record<string, string> = {
  PIX: "Pix",
  TED: "TED",
  DOC: "DOC",
  BOLETO: "Boleto",
  TRANSFER: "Transferencia",
  CREDIT_CARD: "Cartao de credito",
  DEBIT_CARD: "Cartao de debito",
  OTHER: "Outro",
};

function texto(valor: unknown): string | undefined {
  if (valor === null || valor === undefined) return undefined;
  if (typeof valor === "string") return valor.trim() || undefined;
  if (typeof valor === "number" || typeof valor === "boolean") return String(valor);
  return undefined;
}

function participante(bloco: unknown, incluirDocumento: boolean): Detail[] {
  if (!bloco || typeof bloco !== "object") return [];
  const p = bloco as Record<string, unknown>;
  const saida: Detail[] = [];

  const nome = texto(p.name);
  if (nome) saida.push({ label: "Nome", value: nome });

  if (incluirDocumento) {
    const documento = p.documentNumber as { type?: string; value?: string } | null | undefined;
    const valor = texto(documento?.value);
    if (valor) saida.push({ label: documento?.type || "Documento", value: valor });
  }

  const agencia = texto(p.branchNumber);
  const conta = texto(p.accountNumber);
  if (agencia || conta) {
    saida.push({ label: "Agencia/conta", value: [agencia, conta].filter(Boolean).join(" / ") });
  }

  // O ISPB identifica a instituicao no arranjo do Banco Central. Exibimos o
  // codigo cru: nao temos a tabela de nomes, e inventar um mapa incompleto
  // atribuiria o banco errado a algumas transacoes.
  const ispb = texto(p.routingNumberISPB);
  if (ispb) saida.push({ label: "ISPB do banco", value: ispb });

  return saida;
}

interface TransacaoBruta {
  amount: number;
  description?: string;
  descriptionRaw?: string | null;
  paymentData?: Record<string, unknown> | null;
  merchant?: Record<string, unknown> | null;
  creditCardMetadata?: Record<string, unknown> | null;
  operationType?: string | null;
  operationTypeAdditionalInfo?: string | null;
  providerCode?: string | null;
  status?: string | null;
}

export function extractDetails(transaction: TransacaoBruta): Detail[] {
  const detalhes: Detail[] = [];
  const pagamento = (transaction.paymentData ?? {}) as Record<string, unknown>;

  const metodo = texto(pagamento.paymentMethod);
  if (metodo) detalhes.push({ label: "Meio", value: METODOS[metodo] ?? metodo });

  const operacao = texto(transaction.operationType);
  if (operacao) detalhes.push({ label: "Operacao", value: operacao });

  const operacaoInfo = texto(transaction.operationTypeAdditionalInfo);
  if (operacaoInfo) detalhes.push({ label: "Detalhe da operacao", value: operacaoInfo });

  const motivo = texto(pagamento.reason);
  if (motivo) detalhes.push({ label: "Motivo", value: motivo });

  // Identificadores: e aqui que costuma aparecer numero de contrato.
  for (const [campo, rotulo] of [
    ["referenceNumber", "Referencia"],
    ["receiverReferenceId", "Id do recebedor"],
    ["authenticationCode", "Autenticacao"],
  ] as const) {
    const valor = texto(pagamento[campo]);
    if (valor) detalhes.push({ label: rotulo, value: valor });
  }

  const boleto = pagamento.boletoMetadata as Record<string, unknown> | null | undefined;
  if (boleto) {
    for (const [campo, rotulo] of Object.entries(boleto)) {
      const valor = texto(rotulo);
      if (valor) detalhes.push({ label: `Boleto: ${campo}`, value: valor });
    }
  }

  const saida = transaction.amount < 0;

  // Documento do lado que e o proprio usuario nao entra: e o CPF dele.
  detalhes.push(
    ...participante(pagamento.payer, !saida).map((d) => ({
      ...d,
      label: `Pagador · ${d.label}`,
    })),
  );
  detalhes.push(
    ...participante(pagamento.receiver, saida).map((d) => ({
      ...d,
      label: `Recebedor · ${d.label}`,
    })),
  );

  if (transaction.merchant) {
    for (const [campo, valor] of Object.entries(transaction.merchant)) {
      const conteudo = texto(valor);
      if (conteudo) detalhes.push({ label: `Estabelecimento · ${campo}`, value: conteudo });
    }
  }

  if (transaction.creditCardMetadata) {
    for (const [campo, valor] of Object.entries(transaction.creditCardMetadata)) {
      const conteudo = texto(valor);
      if (conteudo) detalhes.push({ label: `Cartao · ${campo}`, value: conteudo });
    }
  }

  const bruta = texto(transaction.descriptionRaw);
  if (bruta && bruta !== transaction.description) {
    detalhes.push({ label: "Descricao original", value: bruta });
  }

  const provedor = texto(transaction.providerCode);
  if (provedor) detalhes.push({ label: "Codigo do provedor", value: provedor });

  return detalhes;
}
