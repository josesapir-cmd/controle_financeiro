-- A categoria fixa de um cartao.
--
-- Numa fatura com adicionais, o gasto de outra pessoa entra misturado com o
-- proprio: o Open Finance nao cria conta separada para o adicional, e o banco
-- nao manda o nome de quem usou. O unico separador que chega e `cardNumber`,
-- os ultimos digitos do plastico, dentro do bloco do cartao de cada
-- lancamento.
--
-- Uma regra aqui diz "tudo o que sair deste cartao e desta categoria" — o caso
-- que motivou isto e o cartao do pai, que vai inteiro para presentes e
-- transferencias. E regra de origem, nao de contraparte: nao importa onde a
-- compra foi feita, importa de quem e o cartao.
--
-- Guardamos o numero em claro. Sao quatro digitos, que sozinhos nao identificam
-- cartao nem pessoa, e e por eles que a consulta agrupa — cifrar impediria
-- justamente o uso.

CREATE TABLE IF NOT EXISTS card_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id     uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  -- Ultimos digitos, como a Pluggy manda em `creditCardMetadata.cardNumber`.
  card_number    text NOT NULL,
  category_id    uuid REFERENCES categories(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  -- Como chamar o cartao na tela: "Cartao do pai". O banco nao manda nome
  -- nenhum, entao quem nomeia e o usuario.
  label          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Um cartao tem uma regra so. Duas linhas para o mesmo plastico dariam
-- resultados diferentes conforme a ordem da consulta.
CREATE UNIQUE INDEX IF NOT EXISTS card_rules_cartao_idx
  ON card_rules (account_id, card_number);
