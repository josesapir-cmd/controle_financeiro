-- Uma despesa que nao e toda minha.
--
-- Pagar o almoco de seis pessoas e reservar o hotel de uma viagem em grupo sao
-- uma cobranca so no extrato, mas duas coisas diferentes: uma parte foi
-- consumo meu, a outra e dinheiro que volta. Somar tudo como gasto inventa uma
-- despesa que nao existe; classificar tudo como emprestimo apaga o almoco que
-- eu de fato comi.
--
-- Por que tabela e nao duas colunas: a divisao pode ter mais de duas partes (o
-- hotel rateado entre tres casais), e cada parte tem categoria propria e, se
-- for reembolso, um devedor proprio. Nada disso cabe na linha do extrato, que
-- continua sendo o que o banco disse.
--
-- A soma das partes tem de fechar com o valor da cobranca. Isso NAO e garantido
-- aqui por constraint: a checagem depende de comparar com outra tabela, e um
-- CHECK que nao pode ser expresso vira um convite a confiar no banco por algo
-- que ele nao esta verificando. Quem garante e `rateio.ts`, com teste.

CREATE TABLE IF NOT EXISTS transaction_splits (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  -- Sempre positivo: e um pedaco do valor, e o sinal ja esta na cobranca.
  amount         numeric(18, 2) NOT NULL CHECK (amount > 0),
  category_id    uuid REFERENCES categories(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  -- Quem deve, quando a parte e reembolso. Cifrado: e nome de pessoa, do mesmo
  -- tipo do que ja vai cifrado em counterparty_name_enc.
  owed_by_enc    text,
  -- Impressao digital do mesmo nome, para agrupar "quanto fulano me deve" sem
  -- decifrar linha por linha.
  owed_by_fp     text,
  -- Ordem em que as partes foram criadas, para a tela nao embaralhar.
  position       integer NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_splits_transacao_idx
  ON transaction_splits (transaction_id, position);

CREATE INDEX IF NOT EXISTS transaction_splits_devedor_idx
  ON transaction_splits (owed_by_fp);

-- O destino da parte que volta.
--
-- `reembolso` e um quarto tipo, e nao um apelido de `investimento`: aporte vira
-- patrimonio e fica, reembolso e credito de curto prazo que se cobra de alguem.
-- A diferenca vai importar quando a tela perguntar quem deve o que.
INSERT INTO categories (name, kind, position, hue, hint) VALUES (
  'A reembolsar',
  'reembolso',
  120,
  145,
  'dinheiro que volta: a parte da conta que outra pessoa me paga'
)
ON CONFLICT (lower(name)) DO UPDATE
  SET kind = 'reembolso',
      position = EXCLUDED.position,
      hint = EXCLUDED.hint,
      archived_at = NULL;
