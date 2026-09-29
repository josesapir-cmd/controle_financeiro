/**
 * O informe diario de fundos da CVM, lido.
 *
 * A pergunta que trouxe isto: "quanto teria rendido se o mesmo dinheiro
 * tivesse ido para o fundo X na mesma data?". Para responder e preciso o valor
 * da cota no dia do aporte e o de hoje — e isso so existe no informe diario,
 * que a CVM publica um arquivo por mes.
 *
 * Aqui mora so o que e pura leitura e conta, porque so isso da para provar sem
 * rede. O download e o zip ficam no script.
 *
 * O cabecalho e procurado por NOME, e nao por posicao: a CVM ja mudou o layout
 * — em 2024 apareceu CNPJ_FUNDO_CLASSE ao lado de CNPJ_FUNDO — e um indice
 * chumbado leria a coluna errada em silencio, que e o pior jeito de errar
 * dinheiro.
 */

const achatar = (s) =>
  String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();

/** So os digitos: a CVM ja publicou CNPJ com e sem pontuacao. */
export function soDigitos(valor) {
  return String(valor ?? "").replace(/\D/g, "");
}

/**
 * Os indices das tres colunas que interessam, ou null se a linha nao for o
 * cabecalho.
 *
 * CNPJ_FUNDO_CLASSE vem antes de CNPJ_FUNDO de proposito: nos arquivos novos a
 * identidade que casa com o CNPJ do fundo e a da classe.
 */
export function colunasDoInformeDiario(linha) {
  const colunas = String(linha ?? "").split(";").map(achatar);
  const achar = (...nomes) => {
    for (const nome of nomes) {
      const i = colunas.indexOf(nome);
      if (i !== -1) return i;
    }
    return -1;
  };

  const cnpj = achar("CNPJ_FUNDO_CLASSE", "CNPJ_FUNDO");
  const data = achar("DT_COMPTC");
  const cota = achar("VL_QUOTA");

  if (cnpj === -1 || data === -1 || cota === -1) return null;
  return { cnpj, data, cota };
}

/** Uma linha do informe, ou null quando ela nao tem os tres campos. */
export function lerLinhaDoInformeDiario(indices, linha) {
  const campos = String(linha ?? "").split(";");

  const cnpj = soDigitos(campos[indices.cnpj]);
  const dia = String(campos[indices.data] ?? "").trim();
  // A CVM escreve o decimal com ponto neste arquivo, ao contrario do Tesouro.
  const cota = Number(String(campos[indices.cota] ?? "").trim());

  if (cnpj.length !== 14) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) return null;
  if (!Number.isFinite(cota) || cota <= 0) return null;

  return { cnpj, dia, cota };
}

/**
 * Um informe inteiro, lido de um fluxo, guardando so as linhas de um fundo.
 *
 * O arquivo de um mes tem milhoes de linhas e centenas de megabytes — todos os
 * fundos do pais. Ler em streaming e filtrar na passagem e o que faz isso caber
 * na memoria; carregar e filtrar depois funcionaria e gastaria um giga a toa.
 */
export async function lerInformeDeFluxo(fluxo, cnpj, criarInterface) {
  const linhas = criarInterface(fluxo);
  let indices = null;
  const pontos = [];

  for await (const linha of linhas) {
    if (!indices) {
      // Ate achar o cabecalho, segue procurando: alguns arquivos tem lixo antes.
      indices = colunasDoInformeDiario(linha);
      continue;
    }
    const ponto = lerLinhaDoInformeDiario(indices, linha);
    if (ponto && ponto.cnpj === cnpj) pontos.push(ponto);
  }

  if (!indices) {
    throw new Error("Nao achei o cabecalho esperado. O layout do arquivo pode ter mudado.");
  }
  return pontos;
}

/**
 * A cota que vale para uma data: a ultima em que houve cotacao ATE ela.
 *
 * Fundo nao cota em fim de semana nem feriado, e aporte lancado num sabado e
 * comum. Pegar a cota seguinte seria usar informacao que ainda nao existia no
 * dia — melhor a ultima conhecida, e dizer de quantos dias atras ela e para
 * quem le poder desconfiar.
 */
export function cotaEm(serie, dia) {
  let melhor = null;
  for (const ponto of serie) {
    if (ponto.dia <= dia && (!melhor || ponto.dia > melhor.dia)) melhor = ponto;
  }
  if (!melhor) return null;

  const dias = Math.round(
    (Date.parse(`${dia}T00:00:00Z`) - Date.parse(`${melhor.dia}T00:00:00Z`)) / 86400000,
  );
  return { ...melhor, atraso: dias };
}

/** Os meses (AAAAMM) que precisam ser baixados para cobrir estas datas. */
export function mesesNecessarios(datas) {
  const meses = new Set();
  for (const d of datas) {
    if (/^\d{4}-\d{2}/.test(String(d ?? ""))) meses.add(String(d).slice(0, 7).replace("-", ""));
  }
  return [...meses].sort();
}

/**
 * O contrafactual: o mesmo dinheiro, no mesmo dia, no fundo.
 *
 * Cotas compradas nao mudam; o que muda e quanto cada uma vale. Por isso a
 * conta e uma divisao e uma multiplicacao, e nao uma taxa composta — taxa
 * media esconde exatamente a volatilidade que se quer comparar.
 */
export function simularAporte({ aportado, compradoEm }, serie, diaFinal) {
  const entrada = cotaEm(serie, compradoEm);
  const saida = cotaEm(serie, diaFinal);
  if (!entrada || !saida || !(aportado > 0)) return null;

  const cotas = aportado / entrada.cota;
  const valor = cotas * saida.cota;

  return {
    cotas,
    valor,
    entrada,
    saida,
    // Dias corridos: o ganho anualizado so faz sentido com o prazo ao lado.
    dias: Math.round(
      (Date.parse(`${saida.dia}T00:00:00Z`) - Date.parse(`${entrada.dia}T00:00:00Z`)) / 86400000,
    ),
  };
}

/**
 * Ganho ao ano equivalente, para prazos diferentes ficarem comparaveis.
 *
 * Devolve null abaixo de um mes: anualizar duas semanas multiplica o ruido por
 * vinte e seis e imprime um numero que parece medida.
 */
export function aoAno(inicial, final, dias) {
  if (!(inicial > 0) || !(final > 0) || !(dias >= 30)) return null;
  return (Math.pow(final / inicial, 365 / dias) - 1) * 100;
}

/** O imposto de um fundo de acoes: 15% sobre o ganho, sem come-cotas. */
export function impostoDeFia(aportado, valor) {
  return Math.max(0, valor - aportado) * 0.15;
}
