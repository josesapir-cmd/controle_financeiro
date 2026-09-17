-- O mesmo titulo com quatro nomes.
--
-- A mesma NTN-B1 Renda+ 2065 chega assim, das quatro custodias:
--
--   Inter        "Tesouro Renda+ Aposentadoria Extra 2065"
--   Nubank       "Tesouro RendA+ 2065"
--   XP           "NTN-B1"
--   BTG          "TESOURO DIRETO - NTN-B1"
--
-- Nenhuma normalizacao de texto junta isso. E adivinhar por tipo e vencimento
-- funcionaria para Tesouro e erraria em CDB: dois bancos emitem CDB de mesmo
-- vencimento e sao papeis diferentes, com risco de credito diferente. Entao
-- quem decide e o usuario, como ja decide a uniao de contraparte.
--
-- A tabela guarda so a decisao. A comparacao acontece na aplicacao, sobre os
-- nomes em claro: o fingerprint e um HMAC, o banco nao tem como casar "NTN-B1"
-- com "TESOURO DIRETO - NTN-B1".
--
-- O apelido e o nome que passa a aparecer na tela. Guardado cifrado como
-- qualquer nome de papel.

CREATE TABLE IF NOT EXISTS instrument_aliases (
  -- Fingerprint do nome cru, do jeito que a custodia escreveu.
  fingerprint   text PRIMARY KEY,
  -- Fingerprint do apelido: e por ele que dois nomes crus se encontram.
  alias_fingerprint text NOT NULL,
  alias_enc     text NOT NULL,
  -- Guardado so para a tela de cadastro poder listar o que foi unido.
  raw_name_enc  text,
  decided_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS instrument_aliases_alias_idx
  ON instrument_aliases (alias_fingerprint);
