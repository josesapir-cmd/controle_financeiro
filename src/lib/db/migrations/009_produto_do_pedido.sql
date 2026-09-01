-- Produto comprado, ligado a cobranca que ja existe.
--
-- A fatura diz "AMAZON BR R$ 199,90" e mais nada. O que foi comprado esta na
-- tela de pedidos da loja, que nao vem pelo Open Finance. O print dessa tela
-- traz o produto, e esta tabela e onde ele se gruda na cobranca.
--
-- Por que tabela e nao coluna em transactions: uma cobranca pode carregar mais
-- de um produto (um pedido com tres itens cobrado de uma vez), e a associacao
-- tem procedencia propria — de que loja veio, de que numero de pedido, com que
-- confianca foi lida. Nada disso pertence a linha do extrato, que continua
-- sendo o que o banco disse.
--
-- A cobranca NAO e criada aqui. Se o produto nao encontrar cobranca, ele nao
-- vira lancamento: seria contar o mesmo dinheiro duas vezes, ja que a compra ja
-- chegou pelo cartao.
CREATE TABLE IF NOT EXISTS transaction_products (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  -- Nome da loja em claro: e rotulo curto, sem dado pessoal, e as telas
  -- agrupam por ele no SQL.
  store          text NOT NULL,
  -- Nome do produto e numero do pedido cifrados: dizem o que a pessoa comprou,
  -- que e da mesma natureza da descricao do lancamento.
  name_enc       text NOT NULL,
  reference_enc  text,
  -- Impressao digital do nome, deterministica, para nao gravar o mesmo produto
  -- duas vezes quando o print for lido de novo. O nome cifrado nao serve para
  -- isso: o nonce e aleatorio, entao o mesmo texto gera linhas diferentes.
  name_fp        text NOT NULL,
  amount         numeric(14,2),
  -- Data do pedido, que costuma ser anterior a da cobranca.
  ordered_on     date,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS transaction_products_unico_idx
  ON transaction_products (transaction_id, name_fp);

CREATE INDEX IF NOT EXISTS transaction_products_transacao_idx
  ON transaction_products (transaction_id);

-- Os pedidos lidos num lote ficam com o lote, ao lado das linhas do saldo
-- compartilhado. Coluna separada em vez de misturar no mesmo JSON porque os
-- lotes pendentes de hoje ja tem `lines_enc` no formato antigo, e um lote
-- pendente no meio de uma fila nao pode quebrar por causa de uma migracao.
ALTER TABLE shared_imports ADD COLUMN IF NOT EXISTS orders_enc text;
