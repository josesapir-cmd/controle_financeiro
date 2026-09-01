-- Taxonomia enxuta: dez categorias de despesa, definidas pelo usuario.
--
-- As dezesseis anteriores vieram do arquivo do Poupa.ai e provaram ser demais:
-- categoria que ninguem usa nao ajuda a classificar, atrapalha — vira mais uma
-- linha para ler antes de decidir.
--
-- O trabalho aqui e mudar a taxonomia SEM perder o que ja foi classificado. Os
-- rotulos de contraparte guardam o nome da categoria como TEXTO, entao mexer na
-- categoria sem reescrever esse texto faria toda contraparte classificada cair
-- em "sem categoria" — trabalho manual jogado fora em silencio.
--
-- Um caminho so para todos os casos: garante o destino, move tudo da origem
-- para ele, arquiva a origem. A primeira versao tinha dois caminhos, renomear e
-- fundir, e quebrou na primeira vez que rodou: o nome de destino "Viagens" ja
-- existia — o usuario o havia criado digitando em Contrapartes — e renomear
-- "Viagem" para ele violou a unicidade. Com um caminho so, destino existente
-- simplesmente vira fusao.

ALTER TABLE categories ADD COLUMN IF NOT EXISTS hint text;

-- ---------------------------------------------------------------------------
-- As dez, e o que entra em cada uma nas palavras do usuario. A descricao vira
-- dado: e onde a regra de borda fica registrada — que restaurante vai em Lazer,
-- nao em Alimentacao — para aparecer na hora da duvida.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE destinos(nome text, pos integer, hue integer, hint text) ON COMMIT DROP;
INSERT INTO destinos VALUES
  ('Moradia', 10, 264,
   'aluguel/financiamento, condominio, IPTU, luz, gas, agua, internet, manutencao, mobiliario'),
  ('Servicos domesticos', 20, 300,
   'folha (salarios, encargos, 13o, ferias), diaristas, terceirizados recorrentes da casa'),
  ('Alimentacao', 30, 100,
   'supermercado, feira, delivery. Restaurante social vai em Lazer e Cultura'),
  ('Transporte', 40, 240,
   'carros (parcela, seguro, IPVA, combustivel, manutencao, estacionamento), apps, taxi'),
  ('Saude', 50, 200,
   'plano, medicos, terapia, farmacia, exames, dentista'),
  ('Educacao', 60, 280,
   'escola, cursos, material, atividades extracurriculares dos filhos, sua propria formacao'),
  ('Lazer e Cultura', 70, 340,
   'restaurantes, bares, streaming, livros, shows, clube, hobbies'),
  ('Viagens', 80, 30,
   'tudo da viagem: passagem, hotel, e o gasto de alimentacao e passeio durante a viagem'),
  ('Vestuario e Cuidados Pessoais', 90, 320,
   'roupas, calcados, cabelo, academia, personal'),
  ('Presentes, Doacoes e Transferencias', 100, 15,
   'presentes, caridade, ajuda a familiares');

-- De onde cada uma herda. "Familia" entra em Presentes, que a descricao do
-- usuario cobre com "ajuda a familiares"; os centros de custo (Pai, Mae, Irma)
-- vao junto — sao exatamente o que da valor a fusao.
CREATE TEMP TABLE mapa(origem text, destino text) ON COMMIT DROP;
INSERT INTO mapa VALUES
  ('casa', 'Moradia'),
  ('folha de pagamento', 'Servicos domesticos'),
  ('mantimentos', 'Alimentacao'),
  ('carro', 'Transporte'),
  ('lazer', 'Lazer e Cultura'),
  ('viagem', 'Viagens'),
  ('doacao', 'Presentes, Doacoes e Transferencias'),
  ('familia', 'Presentes, Doacoes e Transferencias');

-- ---------------------------------------------------------------------------
-- 1. O destino passa a existir, com a cor, a ordem e a descricao certas. Se ja
--    existia — porque o usuario o criou digitando — so e atualizado.
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, kind, position, hue, hint)
SELECT nome, 'despesa', pos, hue, hint FROM destinos
ON CONFLICT (lower(name)) DO UPDATE
  SET kind = 'despesa',
      position = EXCLUDED.position,
      hue = EXCLUDED.hue,
      hint = EXCLUDED.hint,
      archived_at = NULL;

-- Pares origem → destino que sao de fato duas linhas distintas. Quando origem e
-- destino sao a mesma linha (Saude, Educacao, e o proprio destino ja existente),
-- nao ha nada a mover.
CREATE TEMP TABLE par ON COMMIT DROP AS
SELECT o.id AS origem_id, o.name AS origem_nome, d.id AS destino_id, d.name AS destino_nome
  FROM mapa m
  JOIN categories o ON lower(o.name) = m.origem
  JOIN categories d ON lower(d.name) = lower(m.destino)
 WHERE o.id <> d.id;

-- ---------------------------------------------------------------------------
-- 2. Centros de custo que colidem por nome no destino: os rotulos passam a
--    apontar para o vencedor e os duplicados saem. Sem isto, mover violaria a
--    unicidade de (categoria, nome).
--
--    A colisao nao e so contra o que o destino ja tinha: DUAS origens podem cair
--    no mesmo destino — Familia e Doacao caem ambas em Presentes — e trazer cada
--    uma o seu "Mae". Por isso os candidatos entram todos numa lista so e o
--    desempate e por prioridade: quem ja e do destino ganha; entre iguais, o
--    menor id. Comparar so contra o destino deixava esse caso passar, e foi o
--    que o teste pegou.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE centro_duplicado ON COMMIT DROP AS
WITH candidatos AS (
  SELECT DISTINCT cc.id, p.destino_id AS categoria, lower(cc.name) AS chave, 0 AS prioridade
    FROM par p JOIN cost_centers cc ON cc.category_id = p.destino_id
  UNION ALL
  SELECT DISTINCT cc.id, p.destino_id, lower(cc.name), 1
    FROM par p JOIN cost_centers cc ON cc.category_id = p.origem_id
),
ranqueados AS (
  SELECT id,
         first_value(id) OVER (
           PARTITION BY categoria, chave ORDER BY prioridade, id
         ) AS vencedor
    FROM candidatos
)
SELECT id AS origem_id, vencedor AS destino_id FROM ranqueados WHERE id <> vencedor;

UPDATE counterparty_labels l SET cost_center_id = d.destino_id
  FROM centro_duplicado d WHERE l.cost_center_id = d.origem_id;

UPDATE transaction_labels t SET cost_center_id = d.destino_id
  FROM centro_duplicado d WHERE t.cost_center_id = d.origem_id;

DELETE FROM cost_centers WHERE id IN (SELECT origem_id FROM centro_duplicado);

-- 3. O resto dos centros muda de categoria, levando o historico junto.
UPDATE cost_centers cc SET category_id = p.destino_id
  FROM par p WHERE cc.category_id = p.origem_id;

-- 4. Rotulos por lancamento seguem a categoria nova.
UPDATE transaction_labels t SET category_id = p.destino_id
  FROM par p WHERE t.category_id = p.origem_id;

-- 5. E o texto gravado na contraparte, que e o que casa na leitura.
UPDATE counterparty_labels l SET category = p.destino_nome
  FROM par p WHERE lower(trim(l.category)) = lower(p.origem_nome);

-- 6. A origem sai de cena. Arquivar, nao apagar: apagar levaria por cascata os
--    rotulos por lancamento que acabaram de ser repontados.
UPDATE categories SET archived_at = now() WHERE id IN (SELECT origem_id FROM par);

-- ---------------------------------------------------------------------------
-- 7. Sem sucessora: Pet, Extras criancas, Reembolsavel, Outros e o que mais
--    houver. Nenhuma das dez cobre estas e nao ha resposta obvia — comida de
--    cachorro nao e lazer, "extras criancas" tanto pode ser escola quanto
--    passeio. Adivinhar enterraria dinheiro na categoria errada em silencio, que
--    e o que este app existe para impedir.
--
--    Entao o rotulo e LIMPO em vez de chutado: essas contrapartes voltam para a
--    fila de classificar, visiveis no numero "ainda sem categoria".
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE orfa ON COMMIT DROP AS
SELECT c.id, c.name
  FROM categories c
 WHERE c.archived_at IS NULL
   AND c.kind = 'despesa'
   AND lower(c.name) NOT IN (SELECT lower(nome) FROM destinos)
   AND c.id NOT IN (SELECT origem_id FROM par);

UPDATE counterparty_labels l
   SET category = NULL, subcategory = NULL, cost_center_id = NULL
  FROM orfa o WHERE lower(trim(l.category)) = lower(o.name);

DELETE FROM transaction_labels WHERE category_id IN (SELECT id FROM orfa);

UPDATE categories SET archived_at = now() WHERE id IN (SELECT id FROM orfa);

-- ---------------------------------------------------------------------------
-- 8. Renda e Movimentacao continuam, fora da lista de despesa: nao sao gasto,
--    sao o que separa entrada e dinheiro trocando de bolso do que foi consumido.
--    Some-las a lista diria que salario e um tipo de gasto.
-- ---------------------------------------------------------------------------
UPDATE categories SET hint = 'entradas: salario, rendimento, reembolso recebido'
 WHERE lower(name) = 'renda';
UPDATE categories SET hint = 'dinheiro trocando de bolso: aplicacao, transferencia entre contas suas, pagamento de fatura'
 WHERE lower(name) = 'movimentacao';
