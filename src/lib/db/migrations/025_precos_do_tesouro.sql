-- O preco oficial do Tesouro, buscado e nao digitado.
--
-- A conciliacao com o site mostrou o problema: quatro custodias marcam o MESMO
-- titulo a precos diferentes. Inter a 186,95, Nubank a 188,48, BTG e XP a
-- 189,12 — e so o Inter batia com o Tesouro. A Renda+ aparecia R$ 54 mil mais
-- cara do que e, porque tres das quatro estavam com preco velho.
--
-- Nao e erro de metodologia: 1,16% de preco num titulo de quarenta e tres anos
-- de duration sao 2,7 pontos-base de taxa, ou seja, alguns dias de mercado. E
-- defasagem, e ela nao tem como sumir — cada corretora atualiza quando quer.
--
-- Para o Tesouro Direto existe UM preco oficial por dia, publicado. Entao a
-- posicao passa a valer quantidade x PU oficial, e o que a corretora manda
-- vira so a quantidade. A diferenca entre os dois vira diagnostico em vez de
-- virar patrimonio.
--
-- A tabela tem a forma da `instrument_quotes` que a 024 apagou, e a natureza
-- oposta: aquela era digitada e envelhecia em silencio, esta e baixada e traz
-- a data de dentro do arquivo. O que condenava a primeira era nao ter origem.
--
-- `quoted_at` e a Data Base do arquivo, nao a do download. Baixar hoje o
-- arquivo de sexta nao torna o preco de hoje.

CREATE TABLE IF NOT EXISTS treasury_quotes (
  -- Fingerprint do nome do titulo COMO O TESOURO O ESCREVE. O casamento com a
  -- posicao e feito pelo preco, entao esta chave so precisa ser estavel do
  -- lado do arquivo.
  fingerprint   text PRIMARY KEY,
  title         text NOT NULL,
  -- Vencimento do papel, que junto com o nome identifica o titulo.
  maturity      date NOT NULL,
  -- A Data Base do arquivo: o dia a que estes precos se referem.
  quoted_at     date NOT NULL,
  -- A taxa da curva, sem o spread. E a que a tela mostra.
  buy_rate      numeric(10, 4) NOT NULL,
  -- A de recompra. O spread sai da diferenca entre as duas, observado.
  sell_rate     numeric(10, 4) NOT NULL,
  buy_price     numeric(18, 6) NOT NULL,
  -- O preco que vale a posicao vendendo hoje.
  sell_price    numeric(18, 6) NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS treasury_quotes_vencimento_idx
  ON treasury_quotes (maturity);
