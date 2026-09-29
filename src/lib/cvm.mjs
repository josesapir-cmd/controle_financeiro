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
 * Uma serie de cotas colada de qualquer lugar.
 *
 * O informe da CVM tem layout fixo; o que sai de uma lamina, de um extrato da
 * gestora ou de uma planilha nao tem. Como o dado e sempre o mesmo par — um dia
 * e um numero — vale procurar os dois em cada linha em vez de exigir formato.
 *
 * Decimal: quando ha ponto E virgula, o ultimo manda, que resolve tanto
 * "1.234,56" quanto "1,234.56". Com so um separador ele e o decimal — numa
 * serie de cotas "1.234567" e uma cota de um e pouco, nao um milhao.
 */
export function lerSerieSolta(texto) {
  const pontos = [];

  for (const linha of String(texto ?? "").split(/\r?\n/)) {
    const bruta = linha.trim();
    if (!bruta) continue;

    const iso = bruta.match(/(\d{4})-(\d{2})-(\d{2})/);
    const br = bruta.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!iso && !br) continue;

    const dia = iso
      ? `${iso[1]}-${iso[2]}-${iso[3]}`
      : `${br[3]}-${br[2]}-${br[1]}`;

    // O numero e procurado no que sobra depois de tirar a data, senao os
    // proprios digitos dela virariam candidatos.
    const resto = bruta.replace(iso ? iso[0] : br[0], " ");
    const candidatos = resto.match(/-?\d[\d.,]*/g) ?? [];

    let cota = null;
    for (const cru of candidatos) {
      const ultimoPonto = cru.lastIndexOf(".");
      const ultimaVirgula = cru.lastIndexOf(",");
      let normal;

      if (ultimoPonto !== -1 && ultimaVirgula !== -1) {
        normal =
          ultimaVirgula > ultimoPonto
            ? cru.replace(/\./g, "").replace(",", ".")
            : cru.replace(/,/g, "");
      } else {
        normal = cru.replace(",", ".");
      }

      const n = Number(normal);
      if (Number.isFinite(n) && n > 0) {
        cota = n;
        break;
      }
    }

    if (cota !== null) pontos.push({ cnpj: null, dia, cota });
  }

  return pontos.sort((a, b) => a.dia.localeCompare(b.dia));
}

/**
 * Uma serie em JSON no formato {"2013-07-10": {"fundo": 100, "CDI": 30.77}}.
 *
 * E o que sai das ferramentas de comparacao de fundo: um dia por chave, e
 * varias series por dia. Cada uma vira uma serie propria, porque o que se quer
 * nao e so "quanto o fundo rendeu" — e "quanto ele rendeu COMPARADO a".
 *
 * O nivel de cada indice nao importa; so a razao entre duas datas entra na
 * conta. Por isso CDI em 108 e cota em 789 convivem sem normalizacao: o
 * contrafactual divide o de sair pelo de entrar nos dois casos.
 */
export function lerSeriesJson(texto) {
  const bruto = typeof texto === "string" ? JSON.parse(texto) : texto;
  const series = new Map();

  for (const [dia, valores] of Object.entries(bruto ?? {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dia)) continue;
    if (!valores || typeof valores !== "object") continue;

    for (const [nome, valor] of Object.entries(valores)) {
      const n = Number(valor);
      // Dia sem cotacao aparece com a serie ausente — e tambem com zero em
      // alguns exportadores. Os dois significam "nao cotou", e deixar passar
      // faria o contrafactual dividir por zero.
      if (!Number.isFinite(n) || n <= 0) continue;
      if (!series.has(nome)) series.set(nome, []);
      series.get(nome).push({ cnpj: null, dia, cota: n });
    }
  }

  for (const pontos of series.values()) pontos.sort((a, b) => a.dia.localeCompare(b.dia));
  return series;
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
