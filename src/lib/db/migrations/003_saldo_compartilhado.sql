-- Despesas do saldo compartilhado do Nubank.
--
-- O saldo compartilhado nao chega pelo Open Finance: da conta corrente sai um
-- "Transfer - Internal" com o valor cheio do mes e o gasto de verdade acontece
-- do outro lado, invisivel para a API. Esse dinheiro e do usuario e nao pode
-- desaparecer do controle, entao ele entra por print da tela do app, lido e
-- conferido antes de virar lancamento.

-- De onde veio o registro. 'pluggy' e o padrao porque e o que ja existe; tudo
-- que entrar por print fica marcado como 'manual' e pode ser distinguido,
-- reconferido ou removido sem tocar no historico sincronizado.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'pluggy';
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS origin text NOT NULL DEFAULT 'pluggy';

CREATE INDEX IF NOT EXISTS transactions_origin_idx ON transactions (origin);

-- Lote extraido de um ou mais prints, aguardando conferencia.
--
-- Nada e gravado como lancamento direto da leitura da imagem: valor lido errado
-- vira gasto errado no painel, e um numero que ninguem conferiu nao pode entrar
-- no mesmo lugar que o extrato do banco. O lote fica aqui ate o usuario
-- confirmar; as linhas vao cifradas porque sao descricoes de gasto.
CREATE TABLE IF NOT EXISTS shared_imports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- pendente | confirmado | descartado
  status      text NOT NULL DEFAULT 'pendente',
  images      integer NOT NULL DEFAULT 0,
  lines_enc   text NOT NULL,
  note        text,
  settled_at  timestamptz
);

CREATE INDEX IF NOT EXISTS shared_imports_status_idx ON shared_imports (status, created_at DESC);
