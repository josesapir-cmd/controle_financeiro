-- Envio de prints em fila.
--
-- O usuario seleciona quantas imagens quiser e a tela envia em blocos, um apos
-- o outro, todos para o mesmo lote. `envios` conta quantos blocos ja entraram:
-- e o que distingue uma linha repetida dentro do mesmo bloco (duas despesas
-- iguais de verdade, que o modelo viu juntas) de uma repetida entre blocos
-- (possivelmente a mesma despesa fotografada duas vezes).
ALTER TABLE shared_imports ADD COLUMN IF NOT EXISTS envios integer NOT NULL DEFAULT 1;
