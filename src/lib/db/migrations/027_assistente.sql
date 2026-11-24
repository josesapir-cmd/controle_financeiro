-- Acesso da assistente.
--
-- Ate aqui o app tinha um dono so, e "ter sessao" era o mesmo que "poder tudo".
-- A assistente precisa de uma porta propria: enviar prints do saldo
-- compartilhado e classificar aqueles lancamentos — e nada alem disso.
--
-- 1. PAPEL NA CREDENCIAL E NA SESSAO.
--
--    O papel nasce na credencial (a passkey foi registrada por convite de
--    assistente ou nao) e e copiado para a sessao no login. Cada pagina e acao
--    le o papel da SESSAO, que e uma consulta que ja acontece.
--
--    O default 'dono' existe so para as linhas que ja estao aqui — todas do
--    dono. Logo depois ele cai: uma insercao que esquecer de dizer o papel
--    tem de falhar, e nao virar dono em silencio.
ALTER TABLE credentials ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'dono';
ALTER TABLE credentials ALTER COLUMN role DROP DEFAULT;

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS role text NOT NULL DEFAULT 'dono';
ALTER TABLE sessions ALTER COLUMN role DROP DEFAULT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'credentials_role_check') THEN
    ALTER TABLE credentials
      ADD CONSTRAINT credentials_role_check CHECK (role IN ('dono', 'assistente'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'sessions_role_check') THEN
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_role_check CHECK (role IN ('dono', 'assistente'));
  END IF;
END $$;

-- Revogar a assistente apaga as sessoes dela de uma vez.
CREATE INDEX IF NOT EXISTS sessions_role_idx ON sessions (role);

-- 2. ANEXOS POR LANCAMENTO.
--
--    Nota fiscal, recibo, foto do comprovante. Guardados no proprio banco, e
--    cifrados como o resto do texto livre: um recibo diz de quem, do que e
--    quanto — mais do que a descricao que ja vai cifrada.
--
--    No banco, e nao num servico de arquivos, porque os servicos disponiveis
--    servem por URL publica (dificil de adivinhar, mas publica). Aqui o arquivo
--    so sai por uma rota que confere a sessao.
CREATE TABLE IF NOT EXISTS transaction_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id  text NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
  name_enc        text NOT NULL,
  media_type      text NOT NULL,
  size_bytes      integer NOT NULL,
  -- Base64 do arquivo, cifrado. Texto e nao bytea porque a cifra do app
  -- trabalha sobre texto, e um caminho so para cifrar e um lugar so para errar.
  content_enc     text NOT NULL,
  -- Quem anexou: a tela do dono mostra o que a assistente trouxe.
  created_by      text NOT NULL CHECK (created_by IN ('dono', 'assistente')),
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_attachments_transacao_idx
  ON transaction_attachments (transaction_id);
