/**
 * Venda parcial de titulo do Tesouro: que lotes saem e quanto de imposto.
 *
 * A pergunta que trouxe isto: "se eu vender R$ 2 milhoes de Renda+, que
 * boletas entram e quanto pago?". A resposta depende de tres coisas que a
 * posicao consolidada nao tem — a data de cada compra, o preco de cada compra,
 * e a ordem em que a venda consome os lotes —, e por isso a conta e feita
 * sobre as boletas, e nao sobre a posicao.
 *
 * A ordem e PEPS (primeiro que entra, primeiro que sai): a venda consome os
 * lotes mais antigos primeiro, dentro do mesmo titulo e da mesma custodia. O
 * mais antigo tem o maior ganho acumulado E a menor aliquota, entao a ordem
 * nao e escolha de quem vende — e regra, e ela decide o imposto.
 *
 * Aqui mora so a conta. Buscar as boletas e o preco e trabalho do script.
 */

/** A tabela regressiva da renda fixa. `ate` e o ultimo dia da faixa. */
export const FAIXAS_DE_IR = [
  { aliquota: 0.225, ate: 180 },
  { aliquota: 0.2, ate: 360 },
  { aliquota: 0.175, ate: 720 },
  { aliquota: 0.15, ate: null },
];

/**
 * IOF regressivo sobre o rendimento, do dia 0 ao 29. Do 30 em diante e zero.
 *
 * Numa venda PEPS ele quase nunca aparece — os lotes antigos saem primeiro —,
 * mas aparece quando a venda e grande o bastante para chegar na compra do mes,
 * e e justamente o caso de quem esta vendendo quase tudo.
 */
const IOF = [
  1, 0.96, 0.93, 0.9, 0.86, 0.83, 0.8, 0.76, 0.73, 0.7, 0.66, 0.63, 0.6, 0.56, 0.53, 0.5,
  0.46, 0.43, 0.4, 0.36, 0.33, 0.3, 0.26, 0.23, 0.2, 0.16, 0.13, 0.1, 0.06, 0.03,
];

/** O Tesouro negocia em centesimos de titulo. */
const PASSO = 0.01;

const DIA_MS = 86400000;

/** Arredonda quantidade sem ruido de ponto flutuante. */
const q8 = (v) => Math.round(v * 1e8) / 1e8;

export function diasEntre(de, ate) {
  return Math.round(
    (Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / DIA_MS,
  );
}

export function aliquotaDeIr(dias) {
  for (const faixa of FAIXAS_DE_IR) {
    if (faixa.ate === null || dias <= faixa.ate) return faixa.aliquota;
  }
  return 0.15;
}

export function aliquotaDeIof(dias) {
  if (dias < 0) return 1;
  return dias < IOF.length ? IOF[dias] : 0;
}

/**
 * Quando o lote cai para a faixa seguinte, e para qual aliquota.
 *
 * Nulo na faixa de 15%, de onde nao se cai mais. O degrau muda no dia SEGUINTE
 * ao limite: com 720 dias ainda se paga 17,5%.
 */
export function proximoDegrau(compradoEm, em) {
  const dias = diasEntre(compradoEm, em);
  const i = FAIXAS_DE_IR.findIndex((f) => f.ate === null || dias <= f.ate);
  const faixa = FAIXAS_DE_IR[i];
  if (!faixa || faixa.ate === null) return null;

  const compra = Date.parse(`${compradoEm}T00:00:00Z`);
  return {
    dia: new Date(compra + (faixa.ate + 1) * DIA_MS).toISOString().slice(0, 10),
    aliquota: FAIXAS_DE_IR[i + 1].aliquota,
  };
}

const dataDe = (m) => String(m.tradeDate ?? m.date ?? "").slice(0, 10);

/**
 * Entrada, saida ou nada, a partir de um movimento como a Pluggy manda.
 *
 * Transferencia de custodia entra como lote, mas marcado: a data que vem nela
 * e a da transferencia, e nao a da compra original — e a tabela regressiva
 * corre da compra. Lote transferido com a data errada paga a aliquota errada
 * na simulacao, entao ele precisa aparecer como suspeito, e nao como certo.
 */
export function sentidoDoMovimento(m) {
  const tipo = String(m.type ?? "").toUpperCase();
  const mov = String(m.movementType ?? "").toUpperCase();

  if (tipo === "BUY") return { sentido: "entra", origem: "compra" };
  if (tipo === "SELL") return { sentido: "sai", origem: "venda" };
  if (tipo === "TRANSFER") {
    if (mov === "CREDIT") return { sentido: "entra", origem: "transferencia" };
    if (mov === "DEBIT") return { sentido: "sai", origem: "transferencia" };
  }
  return null;
}

/**
 * Os lotes que continuam em carteira depois de todas as vendas passadas.
 *
 * Cada venda antiga ja consumiu os lotes mais antigos — e PEPS para tras
 * tambem. Ignorar isso faria a simulacao vender de novo uma boleta que ja foi
 * vendida, com o ganho e a aliquota dela.
 *
 * `sobra` e quantidade vendida alem do que foi comprado: o historico que a
 * instituicao mandou comeca depois da primeira compra. Nao zera nada sozinho —
 * quem chama decide o que dizer.
 */
export function lotesEmAberto(movimentos) {
  const ordenados = [...movimentos]
    .map((m, i) => ({ m, i, dia: dataDe(m), s: sentidoDoMovimento(m) }))
    .filter((x) => x.s && x.dia)
    .sort((a, b) => a.dia.localeCompare(b.dia) || a.i - b.i);

  const fila = [];
  let sobra = 0;
  const ignorados = movimentos.length - ordenados.length;

  for (const { m, dia, s } of ordenados) {
    const valor = Math.abs(Number(m.amount ?? m.netAmount ?? 0));
    let quantidade = Math.abs(Number(m.quantity ?? 0));
    let preco = Number(m.value ?? 0);

    if (!(quantidade > 0) && preco > 0 && valor > 0) quantidade = valor / preco;
    if (!(preco > 0) && quantidade > 0 && valor > 0) preco = valor / quantidade;
    if (!(quantidade > 0)) continue;

    if (s.sentido === "entra") {
      fila.push({
        compradoEm: dia,
        quantidade: q8(quantidade),
        original: q8(quantidade),
        precoUnitario: preco,
        origem: s.origem,
        id: m.id ?? null,
      });
      continue;
    }

    let falta = quantidade;
    while (falta > 1e-8 && fila.length > 0) {
      const lote = fila[0];
      const tirar = Math.min(lote.quantidade, falta);
      lote.quantidade = q8(lote.quantidade - tirar);
      falta = q8(falta - tirar);
      if (lote.quantidade <= 1e-8) fila.shift();
    }
    sobra = q8(sobra + falta);
  }

  return { lotes: fila, sobra, ignorados };
}

/**
 * O que um pedaco de lote rende vendido hoje, depois de IOF e IR.
 *
 * IR sobre o ganho ja sem o IOF: e assim que a retencao e feita. Prejuizo nao
 * gera imposto negativo no lote — se a venda compensa prejuizo de um lote com
 * ganho de outro, isso e decidido na soma, e nao aqui.
 */
export function venderPedaco(lote, quantidade, preco, em) {
  const dias = diasEntre(lote.compradoEm, em);
  const bruto = quantidade * preco;
  const custo = quantidade * lote.precoUnitario;
  const ganho = bruto - custo;

  const aliqIof = aliquotaDeIof(dias);
  const aliqIr = aliquotaDeIr(dias);
  const iof = Math.max(0, ganho) * aliqIof;
  const ir = Math.max(0, ganho - iof) * aliqIr;

  return {
    ...lote,
    quantidadeVendida: quantidade,
    dias,
    bruto,
    custo,
    ganho,
    aliqIof,
    aliqIr,
    iof,
    ir,
    liquido: bruto - iof - ir,
    degrau: proximoDegrau(lote.compradoEm, em),
  };
}

/**
 * Simula a venda PEPS que levanta `alvo` reais.
 *
 * `modo: "bruto"` le o alvo como valor de venda; `"liquido"` como o que cai na
 * conta depois do imposto. A quantidade total e arredondada PARA CIMA no
 * centesimo de titulo — arredondar para baixo entregaria menos do que foi
 * pedido —, e so depois distribuida pelos lotes, como a B3 faz.
 */
export function simularVenda(lotes, { preco, em, alvo, modo = "bruto" }) {
  const fila = [...lotes]
    .filter((l) => l.quantidade > 0)
    .sort((a, b) => a.compradoEm.localeCompare(b.compradoEm));

  const disponivel = q8(fila.reduce((s, l) => s + l.quantidade, 0));

  let quantidade;
  if (modo === "liquido") {
    // O liquido por titulo muda de lote para lote, entao a quantidade sai
    // andando a fila ate o acumulado passar do alvo.
    let falta = alvo;
    quantidade = 0;
    for (const lote of fila) {
      const umTitulo = venderPedaco(lote, 1, preco, em).liquido;
      if (!(umTitulo > 0)) continue;
      const precisa = falta / umTitulo;
      if (precisa <= lote.quantidade) {
        quantidade += precisa;
        falta = 0;
        break;
      }
      quantidade += lote.quantidade;
      falta -= lote.quantidade * umTitulo;
    }
    if (falta > 0) quantidade = disponivel;
  } else {
    quantidade = alvo / preco;
  }

  quantidade = Math.min(disponivel, Math.ceil(q8(quantidade) / PASSO - 1e-9) * PASSO);
  quantidade = q8(quantidade);

  const pedacos = [];
  let falta = quantidade;
  for (const lote of fila) {
    if (falta <= 1e-8) break;
    const tirar = q8(Math.min(lote.quantidade, falta));
    pedacos.push(venderPedaco(lote, tirar, preco, em));
    falta = q8(falta - tirar);
  }

  const soma = (campo) => pedacos.reduce((s, p) => s + p[campo], 0);
  const ir = soma("ir");
  const bruto = soma("bruto");
  const liquido = soma("liquido");
  const prejuizo = pedacos.reduce((s, p) => s + Math.min(0, p.ganho), 0);

  return {
    em,
    preco,
    modo,
    alvo,
    disponivel,
    quantidade,
    // Meio centavo de folga: o arredondamento para cima no centesimo de titulo
    // ja garante o alvo, e so falta quando a carteira nao tem o bastante.
    insuficiente: (modo === "liquido" ? liquido : bruto) < alvo - 0.005,
    pedacos,
    bruto,
    custo: soma("custo"),
    ganho: soma("ganho"),
    iof: soma("iof"),
    ir,
    liquido,
    prejuizo,
    // Se a venda compensar prejuizo entre lotes, o IR cai. Fica ao lado do
    // calculo lote a lote, e nao no lugar dele: daqui nao da para confirmar
    // como a B3 apura, e o numero conservador e o que nao surpreende.
    irSeCompensar: Math.max(0, ir + prejuizoCompensado(pedacos)),
  };
}

/**
 * Quanto o prejuizo dos lotes perdedores abate, na hipotese de compensacao.
 *
 * Abate primeiro no lote de aliquota MENOR? Nao ha regra aqui que diga; usamos
 * a aliquota media ponderada dos lotes com ganho, que e o meio do caminho entre
 * o melhor e o pior caso. Negativo: e desconto.
 */
function prejuizoCompensado(pedacos) {
  const comGanho = pedacos.filter((p) => p.ganho > 0);
  const base = comGanho.reduce((s, p) => s + (p.ganho - p.iof), 0);
  if (base <= 0) return 0;
  const media = comGanho.reduce((s, p) => s + (p.ganho - p.iof) * p.aliqIr, 0) / base;
  const perda = pedacos.reduce((s, p) => s + Math.min(0, p.ganho), 0);
  return Math.max(perda, -base) * media;
}

/**
 * Quanto se economiza esperando cada lote da venda cair de faixa.
 *
 * Com o MESMO preco: a pergunta e so a do imposto. O mercado pode andar mais
 * que a economia em duas semanas, e isso nao cabe numa tabela — mas saber que
 * a diferenca existe, e de quanto e, e o que permite decidir.
 */
export function economiaEsperando(simulacao) {
  return simulacao.pedacos
    .filter((p) => p.degrau && p.ganho - p.iof > 0)
    .map((p) => ({
      compradoEm: p.compradoEm,
      dia: p.degrau.dia,
      de: p.aliqIr,
      para: p.degrau.aliquota,
      economia: (p.ganho - p.iof) * (p.aliqIr - p.degrau.aliquota),
    }))
    .sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * A venda espalhada por mais de uma fila, com o menor imposto possivel.
 *
 * PEPS amarra a ordem DENTRO de cada titulo e custodia, mas quanto sai de cada
 * fila e escolha de quem vende — sao ordens separadas. Quando uma fila sozinha
 * nao cobre o valor, ou cobre pagando mais, essa escolha e o que sobra para
 * decidir.
 *
 * A cada passo sai o lote da FRENTE de alguma fila (nunca um do meio, que a B3
 * nao deixaria) — o que paga menos imposto por real vendido. E guloso: com
 * filas cujo lote da frente e caro e o seguinte barato, pode nao ser o otimo
 * exato. Mas e explicavel lote a lote, e o otimo exato precisaria de uma
 * busca que ninguem conseguiria conferir na mao.
 *
 * Cada fila e arredondada para cima no centesimo de titulo, separadamente,
 * porque cada uma vira uma ordem propria.
 */
export function planoCombinado(filas, { em, alvo, modo = "bruto" }) {
  const estado = filas.map((f) => {
    const fila = [...f.lotes]
      .filter((l) => l.quantidade > 0)
      .sort((a, b) => a.compradoEm.localeCompare(b.compradoEm));
    return { ...f, fila, i: 0, resto: fila[0]?.quantidade ?? 0, quantidade: 0 };
  });

  let falta = alvo;
  while (falta > 0.005) {
    let melhor = null;
    for (const f of estado) {
      if (f.i >= f.fila.length || !(f.preco > 0)) continue;
      const um = venderPedaco(f.fila[f.i], 1, f.preco, em);
      const custo = (um.ir + um.iof) / um.bruto;
      if (!melhor || custo < melhor.custo) melhor = { f, um, custo };
    }
    if (!melhor) break;

    const { f, um } = melhor;
    const porTitulo = modo === "liquido" ? um.liquido : um.bruto;
    if (!(porTitulo > 0)) {
      f.i += 1;
      f.resto = f.fila[f.i]?.quantidade ?? 0;
      continue;
    }

    const tirar = Math.min(f.resto, falta / porTitulo);
    f.quantidade += tirar;
    falta -= tirar * porTitulo;
    f.resto = q8(f.resto - tirar);
    if (f.resto <= 1e-8) {
      f.i += 1;
      f.resto = f.fila[f.i]?.quantidade ?? 0;
    }
  }

  const ordens = estado
    .filter((f) => f.quantidade > 1e-8)
    .map((f) => {
      const disponivel = f.fila.reduce((s, l) => s + l.quantidade, 0);
      const quantidade = q8(
        Math.min(disponivel, Math.ceil(q8(f.quantidade) / PASSO - 1e-9) * PASSO),
      );
      // A simulacao da fila refaz a conta lote a lote com a quantidade ja
      // arredondada — o valor em reais e so o veiculo para chegar nela.
      const simulacao = simularVenda(f.lotes, {
        preco: f.preco,
        em,
        alvo: quantidade * f.preco * (1 - 1e-12),
      });
      return { chave: f.chave, simulacao };
    });

  const soma = (campo) => ordens.reduce((s, o) => s + o.simulacao[campo], 0);
  const bruto = soma("bruto");
  const liquido = soma("liquido");

  return {
    ordens,
    bruto,
    ganho: soma("ganho"),
    ir: soma("ir"),
    iof: soma("iof"),
    liquido,
    insuficiente: (modo === "liquido" ? liquido : bruto) < alvo - 0.005,
  };
}
