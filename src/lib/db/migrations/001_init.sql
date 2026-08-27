-- Esquema inicial.
--
-- Convencoes:
--   *_enc          valor cifrado na aplicacao (AES-256-GCM). Nunca consultavel.
--   *_fingerprint  HMAC deterministico, para agrupar e casar sem revelar o dado.
--
-- Valores, datas e categorias ficam em claro de proposito: sao o que as telas
-- agregam, e cifra-los levaria toda soma e ordenacao para a memoria do app.

CREATE TABLE IF NOT EXISTS connections (
  item_id          uuid PRIMARY KEY,
  connector_id     integer,
  connector_name   text NOT NULL,
  status           text,
  added_at         timestamptz NOT NULL DEFAULT now(),
  last_synced_at   timestamptz,
  last_sync_error  text
);

-- A identidade de uma conta NAO e o id da Pluggy nem o item: reconectar um banco
-- gera ids novos e orfanaria todo o historico. A chave estavel e o fingerprint
-- de instituicao + numero da conta.
CREATE TABLE IF NOT EXISTS accounts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  fingerprint       text NOT NULL UNIQUE,
  item_id           uuid REFERENCES connections(item_id) ON DELETE SET NULL,
  pluggy_account_id uuid,
  connector_name    text NOT NULL,
  type              text NOT NULL,
  subtype           text,
  name_enc          text,
  number_enc        text,
  balance           numeric(18, 2),
  currency          text NOT NULL DEFAULT 'BRL',
  archived_at       timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounts_item_idx ON accounts (item_id);

CREATE TABLE IF NOT EXISTS transactions (
  id                    text PRIMARY KEY,
  account_id            uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  posted_at             timestamptz NOT NULL,
  -- Dia no fuso local, ja resolvido na escrita: a virada do dia em UTC nao pode
  -- voltar a assombrar as consultas por periodo.
  local_day             date NOT NULL,
  -- Sinal ja normalizado: negativo e dinheiro saindo, em qualquer tipo de conta.
  amount                numeric(18, 2) NOT NULL,
  currency              text NOT NULL DEFAULT 'BRL',
  category              text,
  category_id           text,
  description_enc       text,
  counterparty_fingerprint text,
  counterparty_name_enc text,
  counterparty_doc_enc  text,
  counterparty_self     boolean NOT NULL DEFAULT false,
  details_enc           text,
  first_seen_at         timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_day_idx ON transactions (local_day DESC);
CREATE INDEX IF NOT EXISTS transactions_account_day_idx ON transactions (account_id, local_day DESC);
CREATE INDEX IF NOT EXISTS transactions_counterparty_idx ON transactions (counterparty_fingerprint);

-- Classificacao dada pelo usuario. Categoria e subcategoria em claro porque sao
-- rotulos escolhidos por ele e as telas agrupam por eles; o apelido e cifrado
-- porque costuma ser o nome de uma pessoa.
CREATE TABLE IF NOT EXISTS counterparty_labels (
  fingerprint  text PRIMARY KEY,
  category     text,
  subcategory  text,
  alias_enc    text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS counterparty_labels_category_idx ON counterparty_labels (category);

-- Passkeys registradas. Mais de uma desde o inicio: perder o unico dispositivo
-- nao pode significar perder o acesso.
CREATE TABLE IF NOT EXISTS credentials (
  id            text PRIMARY KEY,
  public_key    bytea NOT NULL,
  counter       bigint NOT NULL DEFAULT 0,
  transports    text[],
  label         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_used_at  timestamptz
);

CREATE TABLE IF NOT EXISTS sessions (
  id          text PRIMARY KEY,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  user_agent  text
);

CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions (expires_at);

-- Desafios de WebAuthn, de vida curta. Guardados no banco em vez de em memoria
-- porque a Vercel roda cada requisicao em uma instancia possivelmente diferente.
CREATE TABLE IF NOT EXISTS auth_challenges (
  id          text PRIMARY KEY,
  challenge   text NOT NULL,
  purpose     text NOT NULL,
  expires_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS app_settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sync_runs (
  id           bigserial PRIMARY KEY,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL DEFAULT 'running',
  detail       text
);
