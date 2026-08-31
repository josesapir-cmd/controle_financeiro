-- Nome oficial separado do apelido, e conciliacao de nomes recortados.
--
-- Ate aqui a contraparte tinha um campo de nome so, o apelido, que substituia o
-- que vinha do extrato na exibicao. Sao duas coisas diferentes: o nome oficial e
-- como a contraparte aparece no extrato e serve para reconhece-la e concilia-la;
-- o apelido e a abreviacao usada para falar dela.
ALTER TABLE counterparty_labels ADD COLUMN IF NOT EXISTS official_name_enc text;

-- Decisoes de identidade entre contrapartes.
--
-- Print de tela corta o nome do estabelecimento; o Open Finance, quando o mesmo
-- gasto chega por la, traz o nome inteiro. Sao a mesma contraparte, e trata-las
-- como duas parte o historico e a classificacao em dois.
--
-- A comparacao acontece sobre os nomes em claro, na aplicacao: o fingerprint e
-- um HMAC, entao o banco nao tem como casar "HOTEL FAZENDA CASC" com "HOTEL
-- FAZENDA CASCATINHA LTDA". Esta tabela guarda so a decisao, nunca o nome.
--
--   to_fingerprint preenchido  -> e a mesma contraparte, agregue junto
--   to_fingerprint NULL        -> sao diferentes mesmo, pare de sugerir
--
-- Decisao do usuario sempre vence a sugestao automatica.
CREATE TABLE IF NOT EXISTS counterparty_links (
  from_fingerprint text PRIMARY KEY,
  to_fingerprint   text,
  decided_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS counterparty_links_to_idx ON counterparty_links (to_fingerprint);
