-- Quando cada lote foi comprado.
--
-- A aliquota da renda fixa cai em degraus: 22,5% ate 180 dias, 20% ate 360,
-- 17,5% ate 720, 15% dali em diante. No dia seguinte a um degrau o mesmo
-- resgate rende mais sem nada ter acontecido no mercado.
--
-- Sem esta coluna a carteira conseguia dizer em que degrau o lote ESTA — a
-- aliquota sai de imposto dividido por lucro, e nos dados reais ela bate
-- cravada: 17,50%, 17,50%, 20,00%. O que ela nao conseguia dizer e QUANDO o
-- lote cai para o degrau seguinte, que e a pergunta que faz alguem esperar
-- duas semanas antes de resgatar.
--
-- A Pluggy manda `purchaseDate` junto de `issueDate` e `gracePeriodDate`. A
-- que conta para a tabela regressiva e a da compra: o prazo corre do dia em
-- que o dinheiro entrou, e nao do dia em que o papel foi emitido.

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS purchase_date date;
