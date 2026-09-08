/**
 * O ramo do estabelecimento vira sugestao de categoria.
 *
 * MCC (ISO 18245) e o codigo de quatro digitos que a bandeira atribui a cada
 * estabelecimento. Ele ja vem em todo lancamento de cartao e diz, sem depender
 * do nome fantasia, que "PAG*XYZ" foi supermercado.
 *
 * Duas regras governam esta tabela:
 *
 * 1. E SUGESTAO, nunca atribuicao. O MCC descreve o ramo do lojista, nao a
 *    intencao da compra: farmacia vende chocolate e supermercado vende
 *    remedio. Quem decide continua sendo quem classifica.
 *
 * 2. Na duvida, NAO mapear. Um codigo sem sugestao custa um segundo de leitura;
 *    uma sugestao errada acesa na bussola custa uma classificacao errada, feita
 *    no automatico por quem confiou nela. Por isso ramos ambiguos — servicos
 *    profissionais, associacoes, marketing direto — ficam de fora de proposito.
 */

/** Nome da categoria, como esta no cadastro. A resolucao e por nome normalizado. */
export type SugestaoDeCategoria =
  | "Alimentacao"
  | "Transporte"
  | "Moradia"
  | "Saude"
  | "Educacao"
  | "Lazer e Cultura"
  | "Viagens"
  | "Compras"
  | "Servicos domesticos";

interface Faixa {
  de: number;
  ate: number;
  categoria: SugestaoDeCategoria;
}

/**
 * Faixas antes de codigos avulsos, do mais especifico para o mais geral.
 * A primeira que casar vence, entao a ordem aqui e a regra de desempate.
 */
const FAIXAS: Faixa[] = [
  // 3000-3299 companhias aereas, 3300-3499 locadoras, 3500-3999 hoteis.
  // A faixa inteira e viagem: locadora de carro fora de viagem e rara o
  // bastante para nao valer a excecao.
  { de: 3000, ate: 3999, categoria: "Viagens" },
  // Consultorio, laboratorio, hospital, dentista.
  { de: 8011, ate: 8099, categoria: "Saude" },
  // Escola, faculdade, curso.
  { de: 8211, ate: 8299, categoria: "Educacao" },
  // Restaurante, bar, lanchonete.
  { de: 5811, ate: 5814, categoria: "Alimentacao" },
];

const CODIGOS: Record<number, SugestaoDeCategoria> = {
  // --- Alimentacao: loja de comida.
  5411: "Alimentacao", // supermercado
  5412: "Alimentacao", // supermercado com outras secoes
  5422: "Alimentacao", // acougue
  5441: "Alimentacao", // doces e confeitaria
  5451: "Alimentacao", // laticinios
  5462: "Alimentacao", // padaria
  5499: "Alimentacao", // mercearia e conveniencia

  // --- Transporte.
  5541: "Transporte", // posto de combustivel
  5542: "Transporte", // posto automatico
  4111: "Transporte", // transporte urbano
  4121: "Transporte", // taxi e aplicativo
  4131: "Transporte", // onibus
  4784: "Transporte", // pedagio
  7512: "Transporte", // locadora de veiculo
  7523: "Transporte", // estacionamento
  7538: "Transporte", // oficina mecanica
  7549: "Transporte", // guincho

  // --- Viagens.
  4511: "Viagens", // companhia aerea
  4722: "Viagens", // agencia de viagem
  7011: "Viagens", // hotel

  // --- Moradia: a casa e o que fica nela.
  5200: "Moradia", // material de construcao
  5211: "Moradia", // madeireira e construcao
  5231: "Moradia", // vidracaria e tintas
  5251: "Moradia", // ferragens
  5261: "Moradia", // jardinagem
  5712: "Moradia", // moveis
  5713: "Moradia", // tapetes e pisos
  5714: "Moradia", // cortinas e estofados
  5718: "Moradia", // lareiras
  5719: "Moradia", // utilidades domesticas
  5722: "Moradia", // eletrodomesticos
  7699: "Moradia", // consertos em geral

  // --- Servicos domesticos.
  7210: "Servicos domesticos", // lavanderia
  7211: "Servicos domesticos", // lavanderia
  7216: "Servicos domesticos", // tinturaria
  7217: "Servicos domesticos", // limpeza de estofados

  // --- Saude.
  5912: "Saude", // farmacia
  5975: "Saude", // aparelhos auditivos
  5976: "Saude", // ortopedia
  8062: "Saude", // hospital
  8071: "Saude", // laboratorio

  // --- Educacao.
  5942: "Educacao", // livraria
  8351: "Educacao", // creche

  // --- Lazer e Cultura.
  5815: "Lazer e Cultura", // midia digital
  5816: "Lazer e Cultura", // jogos digitais
  5817: "Lazer e Cultura", // aplicativos
  5994: "Lazer e Cultura", // banca de jornal
  7829: "Lazer e Cultura", // producao de cinema
  7832: "Lazer e Cultura", // cinema
  7841: "Lazer e Cultura", // locadora de video
  7911: "Lazer e Cultura", // danca
  7922: "Lazer e Cultura", // teatro e ingressos
  7929: "Lazer e Cultura", // banda e orquestra
  7932: "Lazer e Cultura", // bilhar
  7933: "Lazer e Cultura", // boliche
  7991: "Lazer e Cultura", // atracao turistica
  7994: "Lazer e Cultura", // fliperama
  7996: "Lazer e Cultura", // parque de diversao
  7997: "Lazer e Cultura", // clube
  7998: "Lazer e Cultura", // aquario
  7999: "Lazer e Cultura", // recreacao

  // --- Compras: loja de coisa que nao e comida nem casa.
  5310: "Compras", // loja de descontos
  5311: "Compras", // loja de departamento
  5331: "Compras", // loja de variedades
  5399: "Compras", // mercadoria geral
  5611: "Compras", // roupa masculina
  5621: "Compras", // roupa feminina
  5631: "Compras", // acessorios femininos
  5641: "Compras", // roupa infantil
  5651: "Compras", // roupa em geral
  5655: "Compras", // artigos esportivos
  5661: "Compras", // calcados
  5691: "Compras", // roupa sob medida
  5699: "Compras", // vestuario diverso
  5732: "Compras", // eletronicos
  5733: "Compras", // instrumentos musicais
  5734: "Compras", // software
  5735: "Compras", // discos
  5818: "Compras", // grande loja digital
  5944: "Compras", // joalheria
  5945: "Compras", // brinquedos
  5977: "Compras", // cosmeticos
  7230: "Compras", // salao de beleza
  7298: "Compras", // spa e estetica
};

/**
 * A categoria sugerida para o codigo, ou `null` quando nao ha uma boa.
 *
 * `null` e uma resposta legitima e frequente: ramos ambiguos ficam de fora de
 * proposito, para a bussola nao acender uma direcao errada.
 */
export function categoriaDoMcc(mcc: string | null | undefined): SugestaoDeCategoria | null {
  if (!mcc) return null;

  const codigo = Number(String(mcc).trim());
  if (!Number.isInteger(codigo) || codigo < 1000 || codigo > 9999) return null;

  const direto = CODIGOS[codigo];
  if (direto) return direto;

  for (const faixa of FAIXAS) {
    if (codigo >= faixa.de && codigo <= faixa.ate) return faixa.categoria;
  }

  return null;
}
