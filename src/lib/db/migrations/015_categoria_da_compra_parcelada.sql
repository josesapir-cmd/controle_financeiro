-- A categoria de uma compra parcelada, valida para todas as parcelas.
--
-- Dez parcelas chegam como dez lancamentos, um por fatura, e cada um pedia
-- classificacao propria. Mas a decisao e uma so: quem escolheu a categoria no
-- mes da compra ja disse o que a parcela de marco de 2027 e — e essa parcela ja
-- esta no banco, porque a fatura manda as futuras junto.
--
-- E por compra, e nao por contraparte: `counterparty_labels` diria "toda compra
-- nesta loja e X", que e outra afirmacao. Duas compras na mesma loja podem ser
-- coisas diferentes, e uma delas parcelada.
--
-- A chave e um fingerprint HMAC do que identifica a compra — cartao, instante,
-- prazo e descricao normalizada. Guardar o texto em claro daria o nome do
-- estabelecimento de graca a quem lesse a tabela.

CREATE TABLE IF NOT EXISTS installment_labels (
  purchase_key   text PRIMARY KEY,
  category_id    uuid REFERENCES categories(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
