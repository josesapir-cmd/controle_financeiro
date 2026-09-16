-- O patrimonio que o Open Finance nao ve.
--
-- A carteira de 018 e o que a Pluggy entrega. Mas parte do patrimonio nao passa
-- por banco nenhum: cota de FIDC fechado, cripto em carteira propria, imovel,
-- participacao em empresa. Ignorar isso nao deixa a soma neutra — deixa ela
-- errada para baixo, e com cara de completa.
--
-- Tabela separada de `investments` de proposito. Aquela e uma fotografia
-- reescrita a cada sincronizacao; esta e digitada a mao e so muda quando alguem
-- decide mudar. Guardar as duas juntas seria pedir que um dia uma
-- sincronizacao apague o que ninguem consegue re-sincronizar.
--
-- `valued_at` e obrigatorio. O valor de um ativo manual envelhece sem avisar —
-- uma cota avaliada ha dezoito meses parece tao atual quanto uma de ontem, e a
-- data ao lado do numero e o que impede a tela de mentir com sinceridade.

CREATE TABLE IF NOT EXISTS manual_investments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_enc     text NOT NULL,
  -- Onde esta custodiado, quando faz sentido dizer. Cripto em carteira propria
  -- nao tem custodiante, e inventar um seria pior que deixar em branco.
  institution  text,
  type         text NOT NULL,
  subtype      text,
  balance      numeric(18, 2) NOT NULL,
  amount       numeric(18, 2),
  profit       numeric(18, 2),
  annual_rate  numeric(10, 4),
  due_date     date,
  currency     text NOT NULL DEFAULT 'BRL',
  -- Quando este valor foi apurado. Nao e quando a linha foi escrita.
  valued_at    date NOT NULL,
  -- De onde veio o numero: "informe de rendimentos 2025", "cotacao Binance".
  -- Daqui a um ano e a unica coisa que permite conferir.
  note_enc     text,
  archived_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manual_investments_ativos_idx
  ON manual_investments (archived_at) WHERE archived_at IS NULL;
