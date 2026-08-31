-- Categorias e centros de custo.
--
-- Ate aqui categoria e subcategoria eram texto livre digitado por contraparte.
-- Funciona para rotular, mas nao para o que o usuario quer agora: tratar cada
-- viagem, cada obra e cada pessoa da familia como um centro de custo com vida
-- propria — que pode ter orcamento, comeco e fim, e existir antes de ter o
-- primeiro gasto.
--
-- Texto livre tambem nao tem identidade: renomear "Viagem" exigiria reescrever
-- todas as linhas, e uma grafia diferente criava uma categoria nova em silencio.
--
-- Os nomes ficam em claro, como ja ficavam em counterparty_labels: sao rotulos
-- escolhidos pelo usuario e sao exatamente o que as telas agrupam no SQL.

CREATE TABLE IF NOT EXISTS categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- despesa | receita | movimentacao. Movimentacao e dinheiro trocando de
  -- bolso, que nao pode ser somado como gasto.
  kind        text NOT NULL DEFAULT 'despesa',
  position    integer NOT NULL DEFAULT 100,
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Nome unico ignorando caixa: "Viagem" e "viagem" sao a mesma categoria, e
-- deixar as duas coexistirem e como o texto livre se degradava.
CREATE UNIQUE INDEX IF NOT EXISTS categories_nome_idx ON categories (lower(name));

CREATE TABLE IF NOT EXISTS cost_centers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name        text NOT NULL,
  note        text,
  -- Uma viagem tem comeco e fim; uma pensao para o pai, nao. Ambos opcionais.
  starts_on   date,
  ends_on     date,
  budget      numeric(18, 2),
  archived_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_nome_idx
  ON cost_centers (category_id, lower(name));

CREATE INDEX IF NOT EXISTS cost_centers_categoria_idx ON cost_centers (category_id);

-- A contraparte passa a apontar para o centro de custo. As colunas de texto
-- continuam preenchidas para nao quebrar nada que ainda as leia, e porque sao a
-- fonte deste backfill.
ALTER TABLE counterparty_labels
  ADD COLUMN IF NOT EXISTS cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS counterparty_labels_centro_idx
  ON counterparty_labels (cost_center_id);

-- Backfill: o que ja foi classificado vira taxonomia, sem perder trabalho feito.
INSERT INTO categories (name)
SELECT DISTINCT trim(category) FROM counterparty_labels
 WHERE category IS NOT NULL AND trim(category) <> ''
ON CONFLICT (lower(name)) DO NOTHING;

INSERT INTO cost_centers (category_id, name)
SELECT DISTINCT c.id, trim(l.subcategory)
  FROM counterparty_labels l
  JOIN categories c ON lower(c.name) = lower(trim(l.category))
 WHERE l.subcategory IS NOT NULL AND trim(l.subcategory) <> ''
ON CONFLICT (category_id, lower(name)) DO NOTHING;

UPDATE counterparty_labels l
   SET cost_center_id = cc.id
  FROM cost_centers cc
  JOIN categories c ON c.id = cc.category_id
 WHERE lower(c.name) = lower(trim(l.category))
   AND lower(cc.name) = lower(trim(l.subcategory))
   AND l.cost_center_id IS NULL;

-- Semente: as categorias do Poupa.ai, onde a assistente ja classifica os gastos
-- do saldo compartilhado. Usar a mesma taxonomia dos dois lados evita ter de
-- traduzir na hora de importar o arquivo dela.
--
-- Duas mudancas em relacao ao arquivo: "aulas / educacao" e "educacao" viram
-- uma so, e "familia do jose" vira "Familia" — o dono do app nao precisa
-- aparecer no nome da propria categoria. "Viagem" nao existe la e entra aqui
-- porque e o caso que motivou os centros de custo.
INSERT INTO categories (name, kind, position) VALUES
  ('Casa',               'despesa',      10),
  ('Carro',              'despesa',      20),
  ('Mantimentos',        'despesa',      30),
  ('Folha de pagamento', 'despesa',      40),
  ('Extras criancas',    'despesa',      50),
  ('Educacao',           'despesa',      60),
  ('Saude',              'despesa',      70),
  ('Familia',            'despesa',      80),
  ('Pet',                'despesa',      90),
  ('Lazer',              'despesa',     100),
  ('Viagem',             'despesa',     110),
  ('Doacao',             'despesa',     120),
  ('Reembolsavel',       'despesa',     130),
  ('Outros',             'despesa',     900),
  ('Renda',              'receita',      10),
  ('Movimentacao',       'movimentacao', 10)
ON CONFLICT (lower(name)) DO NOTHING;
