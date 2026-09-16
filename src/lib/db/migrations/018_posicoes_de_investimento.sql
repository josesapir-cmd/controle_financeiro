-- A carteira que o Open Finance ja manda.
--
-- Ate aqui o app so lia conta corrente e cartao. Mas a Pluggy entrega tambem a
-- posicao de investimento — Tesouro, CDB, debenture, CRI, fundo — e ela e a
-- outra metade do patrimonio: sem isso, a tela diz quanto saiu e nunca quanto
-- existe.
--
-- A posicao NAO e um lancamento. Ela nao tem data de competencia nem entra em
-- soma de gasto: e uma fotografia do que se tem hoje, reescrita a cada
-- sincronizacao. Por isso tabela propria, e por isso `updated_at` importa mais
-- que `created_at` — uma posicao velha e pior que nenhuma, porque parece atual.
--
-- O nome do papel vai cifrado: "CDB BANCO X 2027" e "FUNDO Y MULTIMERCADO"
-- dizem o que a pessoa tem, do mesmo tipo do que ja vai cifrado na descricao
-- do lancamento. Tipo e subtipo ficam em claro — sao rotulos de um conjunto
-- fechado, e e por eles que a tela agrupa no SQL.

CREATE TABLE IF NOT EXISTS investments (
  -- O id da Pluggy: re-sincronizar atualiza em vez de duplicar.
  id           text PRIMARY KEY,
  item_id      uuid REFERENCES connections(item_id) ON DELETE CASCADE,
  -- Nome do conector, para agrupar por instituicao sem depender do item.
  institution  text NOT NULL,
  -- FIXED_INCOME, MUTUAL_FUND, EQUITY, SECURITY...
  type         text NOT NULL,
  -- TREASURY, CDB, DEBENTURES, CRI, INVESTMENT_FUND, MULTIMARKET_FUND...
  subtype      text,
  name_enc     text,
  issuer_enc   text,
  -- Valor de mercado hoje. E o numero que a tela soma.
  balance      numeric(18, 2),
  -- Quanto foi aportado, e quanto disso e lucro.
  amount       numeric(18, 2),
  profit       numeric(18, 2),
  -- Taxa contratada, quando ha. Renda fixa tem; fundo nao.
  annual_rate  numeric(10, 4),
  due_date     date,
  currency     text NOT NULL DEFAULT 'BRL',
  status       text,
  -- Quando esta posicao foi vista pela ultima vez na Pluggy. Posicao que parou
  -- de aparecer foi resgatada, e a tela precisa poder dizer isso em vez de
  -- continuar somando um papel que nao existe mais.
  seen_at      timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS investments_item_idx ON investments (item_id);
CREATE INDEX IF NOT EXISTS investments_tipo_idx ON investments (type, subtype);
