-- Cor da categoria e classificacao por lancamento.
--
-- Duas coisas que o novo desenho da tela de categorias exige.
--
-- 1. MATIZ POR CATEGORIA. Os blocos coloridos precisam de uma cor estavel por
--    categoria, que sobreviva a renomear e a criar outras. Guardamos so a
--    matiz; os cinco tons (cheio, texto, fundo, borda, anel) saem dela no CSS,
--    em OKLCH, todos com a mesma luminosidade e croma do azul do app.
--
--    A cor aqui e sinalizacao de interface, nao codificacao de dado: cada bloco
--    leva o nome escrito. E a distincao que permite ter 16 matizes sem cair no
--    problema de leitura que o mapa do gasto evita usando um tom so.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS hue integer;

-- Matizes das seis categorias que o desenho nomeia, e uma distribuicao para as
-- demais que evita vizinhanca proxima.
UPDATE categories SET hue = c.hue FROM (VALUES
  ('casa', 264), ('folha de pagamento', 300), ('viagem', 30), ('saude', 200),
  ('familia', 145), ('compras', 340), ('carro', 240), ('mantimentos', 100),
  ('extras criancas', 320), ('educacao', 280), ('pet', 60), ('lazer', 175),
  ('doacao', 15), ('reembolsavel', 220), ('outros', 250), ('renda', 150),
  ('movimentacao', 260)
) AS c(nome, hue)
WHERE lower(categories.name) = c.nome AND categories.hue IS NULL;

-- Quem nao estava na lista recebe matiz espalhada, deterministica pela ordem.
WITH ordenadas AS (
  SELECT id, row_number() OVER (ORDER BY position, name) AS n
    FROM categories WHERE hue IS NULL
)
UPDATE categories SET hue = ((ordenadas.n - 1) * 47 + 10) % 360
  FROM ordenadas WHERE categories.id = ordenadas.id;

ALTER TABLE categories ALTER COLUMN hue SET DEFAULT 250;

-- 2. CLASSIFICACAO POR LANCAMENTO.
--
--    Ate aqui a classificacao vivia so na contraparte, o que basta para a
--    padaria e nao basta para uma pessoa: um Pix para a mesma pessoa pode ser
--    Familia num mes e Viagem no outro. Arrastar UM lancamento para uma
--    categoria precisa valer para aquele lancamento.
--
--    A regra de leitura passa a ser: o rotulo do lancamento vence o da
--    contraparte. Marcar "aplicar a todos da contraparte" continua gravando no
--    cadastro de contraparte, que e o que ja existia.
CREATE TABLE IF NOT EXISTS transaction_labels (
  transaction_id text PRIMARY KEY REFERENCES transactions(id) ON DELETE CASCADE,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  category_id    uuid REFERENCES categories(id) ON DELETE CASCADE,
  -- Comentario do usuario sobre aquele gasto. Cifrado: e texto livre sobre
  -- dinheiro, a mesma natureza da descricao.
  note_enc       text,
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transaction_labels_centro_idx ON transaction_labels (cost_center_id);
CREATE INDEX IF NOT EXISTS transaction_labels_categoria_idx ON transaction_labels (category_id);
