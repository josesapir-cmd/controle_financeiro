-- O que a Pluggy sempre mandou e o app nunca leu.
--
-- A carteira exibia `balance`, e `balance` e LIQUIDO. A conta fecha ao centavo
-- em toda posicao de renda fixa:
--
--   balance = amount - taxes - taxes2
--
-- E `amount` e o valor de mercado bruto, que confere com `quantity * value` —
-- tambem ao centavo. Entao o bruto sempre esteve na resposta, num campo que
-- ninguem estava lendo.
--
-- Nos fundos a diferenca existe sem campo de imposto que a explique
-- (QUARTIER: amount 14.737.212,11, balance 13.795.630,29). Nao sei o que ela e,
-- e por isso guardo os dois: quem exibe escolhe, e o dia que alguem descobrir
-- o motivo nao precisa re-sincronizar nada.
--
-- Junto vem o que faltava para a tela parar de pedir digitacao:
--
--   quantity + unit_price  o preco unitario, que e a "marcacao" que estava
--                          sendo digitada a mao em instrument_quotes
--   fixed_annual_rate      a taxa CONTRATADA no lote — 7,02 no lote de 575,53
--                          titulos, que e exatamente o que o extrato do
--                          Tesouro diz. A coluna Taxa mostrava traco para
--                          Tesouro porque lia `annualRate`, que vem nulo.
--   index_percent          o percentual do indexador: 100 no Tesouro, 102 no
--                          CDB do Inter, 70 num CRI.

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS gross_amount      numeric(18, 2),
  ADD COLUMN IF NOT EXISTS taxes             numeric(18, 2),
  ADD COLUMN IF NOT EXISTS quantity          numeric(20, 8),
  ADD COLUMN IF NOT EXISTS unit_price        numeric(18, 8),
  ADD COLUMN IF NOT EXISTS fixed_annual_rate numeric(10, 4),
  ADD COLUMN IF NOT EXISTS index_percent     numeric(10, 4);
