-- A remuneracao que chega por fora do extrato.
--
-- O banco mostra um credito de R$ 988.069,17 vindo de uma empresa. Ele nao
-- mostra que isso foi 3,15% de um lucro de R$ 33,4 milhoes, que R$ 21 mil de
-- plano de saude e R$ 51 mil de adiantamento sairam antes, nem a que trimestre
-- aquilo se refere. Essas quatro coisas so existem no aviso de pagamento, e sao
-- justamente as que respondem "quanto eu ganhei" em vez de "quanto entrou".
--
-- Tabela separada de `transactions` por um motivo duro: o pagamento de um
-- trimestre recente JA esta no extrato sincronizado. Escrever a mesma entrada
-- aqui e la faria o mesmo dinheiro ser contado duas vezes em todo relatorio de
-- receita. Entao esta tabela e registro, nao lancamento — nenhuma soma de
-- receita le daqui. O que ela da e o historico por competencia, a participacao
-- e o imposto retido, que o extrato nao tem como saber.
--
-- Competencia e caixa andam separados de proposito. O 4o trimestre e apurado em
-- dezembro e pago em janeiro; somar por `paid_on` responde o ano fiscal, somar
-- por `period_start` responde o ano de trabalho, e as duas perguntas sao feitas.

CREATE TABLE IF NOT EXISTS partner_income (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Quem paga. Cifrado como qualquer contraparte: o valor em claro ao lado do
  -- nome do empregador e o par que mais incomoda vazar.
  source_enc        text NOT NULL,
  -- HMAC do mesmo nome, so para a chave unica e para agrupar. Sem ele a unica
  -- alternativa seria ler a tabela inteira e decifrar para saber se a linha ja
  -- existe.
  source_fingerprint text NOT NULL,
  -- Como a pessoa chama o periodo: "3T2025". E o rotulo do aviso, nao um
  -- derivado de datas — um dia vira "1o Sem 2027" e continua sendo o rotulo.
  period_label      text NOT NULL,
  -- Primeiro dia da competencia. Ordena e agrupa por ano de trabalho.
  period_start      date NOT NULL,
  -- Nulo enquanto nao pagou. Trimestre apurado com saldo devedor existe: o
  -- valor foi apurado, abatido de adiantamentos, e nada caiu na conta.
  paid_on           date,
  -- Participacao total do periodo, ja somando o adicional de tesouraria.
  share_pct         numeric(7, 4),
  -- A base sobre a qual a participacao incidiu.
  distributable     numeric(18, 2),
  -- Antes de qualquer desconto.
  gross             numeric(18, 2) NOT NULL,
  -- Descontos, NEGATIVOS, separados porque sao coisas diferentes: plano de
  -- saude e custo de beneficio, adiantamento e emprestimo sendo devolvido.
  health_plan       numeric(18, 2) NOT NULL DEFAULT 0,
  settlements       numeric(18, 2) NOT NULL DEFAULT 0,
  -- Retido na fonte, POSITIVO. Nao e despesa: e credito contra o imposto
  -- devido, e por isso aparece na carteira em vez de sumir aqui dentro.
  withheld_tax      numeric(18, 2) NOT NULL DEFAULT 0,
  -- O que foi creditado. Invariante:
  --   net = gross + health_plan + settlements - withheld_tax
  net               numeric(18, 2) NOT NULL,
  note_enc          text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  -- Reimportar a mesma planilha atualiza em vez de duplicar. Sem isto, rodar o
  -- import duas vezes dobraria o historico sem nenhum sinal na tela.
  UNIQUE (source_fingerprint, period_label)
);

CREATE INDEX IF NOT EXISTS partner_income_competencia_idx
  ON partner_income (period_start DESC);
CREATE INDEX IF NOT EXISTS partner_income_caixa_idx
  ON partner_income (paid_on DESC) WHERE paid_on IS NOT NULL;
