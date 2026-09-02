-- A ordem das categorias na bussola do modo jogo.
--
-- A bussola tem oito lugares e as categorias sao dez, entao ela tem duas
-- voltas. Quem cai na segunda custa um `tab` a mais, e por isso a segunda volta
-- tem de ser ocupada pelas categorias que menos aparecem — Saude e Educacao,
-- que sao gasto grande e raro, nao gasto de todo dia.
--
-- A ordem vem de `position`, a mesma que a aba de categorias usa. E de
-- proposito: a bussola so vale a pena se a posicao for estavel o bastante para
-- a mao decorar, e uma ordem que existe em um lugar so nao seria estavel — a
-- primeira mudanca na outra tela a desfaria.
--
-- As quatro primeiras ganham as setas retas (uma tecla); as quatro seguintes,
-- as diagonais (duas teclas). Por isso a ordem aqui e a do uso, do mais comum
-- para o mais raro, e nao a alfabetica.
UPDATE categories SET position = c.pos FROM (VALUES
  ('moradia', 10),
  ('servicos domesticos', 20),
  ('alimentacao', 30),
  ('transporte', 40),
  ('lazer e cultura', 50),
  ('viagens', 60),
  ('compras', 70),
  ('presentes, doacoes e transferencias', 80),
  -- Segunda volta da bussola.
  ('saude', 90),
  ('educacao', 100)
) AS c(nome, pos)
WHERE lower(categories.name) = c.nome;
