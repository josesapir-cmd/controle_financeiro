-- Contas de uma conexao removida devem parar de contar saldo, sem perder
-- historico.
--
-- O saldo e uma foto do momento da ultima sincronizacao. Sem a conexao, ele
-- congela e passa a mentir — somado ao patrimonio liquido, faz o numero mais
-- proeminente da tela ficar errado em silencio. As transacoes, ao contrario,
-- sao fatos passados e continuam validas para sempre.

CREATE OR REPLACE FUNCTION arquivar_contas_da_conexao() RETURNS trigger AS $$
BEGIN
  UPDATE accounts
     SET archived_at = now()
   WHERE item_id = OLD.item_id
     AND archived_at IS NULL;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS arquivar_contas ON connections;

-- BEFORE DELETE: depois do delete o item_id das contas ja teria virado NULL
-- pelo ON DELETE SET NULL, e nao haveria como saber quais arquivar.
CREATE TRIGGER arquivar_contas
  BEFORE DELETE ON connections
  FOR EACH ROW
  EXECUTE FUNCTION arquivar_contas_da_conexao();

-- Reconectar a mesma conta a desarquiva: o upsert por fingerprint volta a
-- encontra-la, e uma conta ativa nao pode ficar marcada como arquivada.
