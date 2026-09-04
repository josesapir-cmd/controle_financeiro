-- Chamada de capital chamada, e chamada paga.
--
-- Ate aqui registrar a chamada era registrar o pagamento, e as duas coisas nao
-- acontecem no mesmo dia: o gestor avisa, e o dinheiro sai dias ou semanas
-- depois. Entre um e outro existe uma obrigacao com data marcada — o pior tipo
-- de despesa para descobrir tarde.
--
-- Duas colunas seriam a solucao obvia (chamada_em, pago_em), mas `called_on` ja
-- guarda a data que importa para o historico. O que falta e so o carimbo de
-- quando saiu, e null nele quer dizer "ainda nao saiu".
--
-- As chamadas que ja existem sao dadas como liquidadas: foram cadastradas
-- quando registrar significava pagar, e marca-las como pendentes inventaria uma
-- divida que nao existe.

ALTER TABLE capital_calls
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

UPDATE capital_calls SET settled_at = created_at WHERE settled_at IS NULL;
