-- Taxonomia enxuta: dez categorias de despesa, definidas pelo usuario.
--
-- As dezesseis anteriores vieram do arquivo do Poupa.ai e provaram ser demais:
-- categoria que ninguem usa nao ajuda a classificar, atrapalha — vira mais uma
-- linha para ler antes de decidir.
--
-- O trabalho aqui e mudar a taxonomia SEM perder o que ja foi classificado. Os
-- rotulos de contraparte guardam o nome da categoria como TEXTO, entao renomear
-- a categoria sem reescrever o texto faria toda contraparte classificada cair em
-- "sem categoria" — trabalho manual jogado fora em silencio.

-- A descricao que o usuario escreveu para cada categoria vira dado: e o lugar
-- onde "restaurante vai em Lazer, nao em Alimentacao" fica escrito, e a tela de
-- classificar pode mostrar na hora da duvida.
ALTER TABLE categories ADD COLUMN IF NOT EXISTS hint text;

-- ---------------------------------------------------------------------------
-- 1. Renomeacoes: cada uma tem sucessora direta.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE mapa_renome(antigo text, novo text, hue integer, hint text) ON COMMIT DROP;
INSERT INTO mapa_renome VALUES
  ('casa', 'Moradia', 264,
   'aluguel/financiamento, condominio, IPTU, luz, gas, agua, internet, manutencao, mobiliario'),
  ('folha de pagamento', 'Servicos domesticos', 300,
   'folha (salarios, encargos, 13o, ferias), diaristas, terceirizados recorrentes da casa'),
  ('mantimentos', 'Alimentacao', 100,
   'supermercado, feira, delivery. Restaurante social vai em Lazer e Cultura'),
  ('carro', 'Transporte', 240,
   'carros (parcela, seguro, IPVA, combustivel, manutencao, estacionamento), apps, taxi'),
  ('saude', 'Saude', 200,
   'plano, medicos, terapia, farmacia, exames, dentista'),
  ('educacao', 'Educacao', 280,
   'escola, cursos, material, atividades extracurriculares dos filhos, sua propria formacao'),
  ('lazer', 'Lazer e Cultura', 340,
   'restaurantes, bares, streaming, livros, shows, clube, hobbies'),
  ('viagem', 'Viagens', 30,
   'tudo da viagem: passagem, hotel, e o gasto de alimentacao e passeio durante a viagem'),
  ('doacao', 'Presentes, Doacoes e Transferencias', 15,
   'presentes, caridade, ajuda a familiares');

UPDATE categories c
   SET name = m.novo, hue = m.hue, hint = m.hint, kind = 'despesa'
  FROM mapa_renome m
 WHERE lower(c.name) = m.antigo;

-- O texto gravado na contraparte acompanha o novo nome. Sem isto, tudo que ja
-- estava classificado deixaria de casar e cairia em "sem categoria".
UPDATE counterparty_labels l
   SET category = m.novo
  FROM mapa_renome m
 WHERE lower(trim(l.category)) = m.antigo;

-- ---------------------------------------------------------------------------
-- 2. Categorias que faltavam.
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, kind, position, hue, hint) VALUES
  ('Vestuario e Cuidados Pessoais', 'despesa', 90, 320,
   'roupas, calcados, cabelo, academia, personal')
ON CONFLICT (lower(name)) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. Fusao: "Familia" entra em Presentes, Doacoes e Transferencias, que a
--    descricao do usuario cobre com "ajuda a familiares". Os centros de custo
--    (Pai, Mae, Irma) vao junto — sao exatamente o que da valor a fusao.
-- ---------------------------------------------------------------------------
UPDATE cost_centers cc
   SET category_id = destino.id
  FROM categories origem, categories destino
 WHERE cc.category_id = origem.id
   AND lower(origem.name) = 'familia'
   AND lower(destino.name) = lower('Presentes, Doacoes e Transferencias')
   -- Nome que ja existe no destino nao pode ser movido: violaria a unicidade.
   AND NOT EXISTS (
     SELECT 1 FROM cost_centers x
      WHERE x.category_id = destino.id AND lower(x.name) = lower(cc.name)
   );

UPDATE transaction_labels tl
   SET category_id = destino.id
  FROM categories origem, categories destino
 WHERE tl.category_id = origem.id
   AND lower(origem.name) = 'familia'
   AND lower(destino.name) = lower('Presentes, Doacoes e Transferencias');

UPDATE counterparty_labels
   SET category = 'Presentes, Doacoes e Transferencias'
 WHERE lower(trim(category)) = 'familia';

-- ---------------------------------------------------------------------------
-- 4. Sem sucessora: Pet, Extras criancas, Reembolsavel, Outros.
--
--    Nenhuma das dez cobre estas, e nao ha resposta obvia — comida de cachorro
--    nao e lazer, "extras criancas" tanto pode ser escola quanto passeio. Adivinhar
--    enterraria dinheiro na categoria errada em silencio, que e exatamente o que
--    este app existe para impedir.
--
--    Entao o rotulo e LIMPO em vez de chutado: essas contrapartes voltam para a
--    fila de classificar, visiveis no numero "ainda sem categoria". Custa alguns
--    minutos e nao mente.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE sem_sucessora(nome text) ON COMMIT DROP;
INSERT INTO sem_sucessora VALUES ('pet'), ('extras criancas'), ('reembolsavel'), ('outros');

UPDATE counterparty_labels l
   SET category = NULL, subcategory = NULL, cost_center_id = NULL
  FROM sem_sucessora s
 WHERE lower(trim(l.category)) = s.nome;

DELETE FROM transaction_labels tl
 USING categories c, sem_sucessora s
 WHERE tl.category_id = c.id AND lower(c.name) = s.nome;

-- ---------------------------------------------------------------------------
-- 5. Arquiva o que sobrou de despesa fora da lista. Arquivar, nao apagar: apagar
--    levaria junto os centros de custo por cascata, e com eles o historico de
--    quem ainda aponta para la.
-- ---------------------------------------------------------------------------
UPDATE categories
   SET archived_at = now()
 WHERE archived_at IS NULL
   AND kind = 'despesa'
   AND lower(name) NOT IN (
     'moradia', 'servicos domesticos', 'alimentacao', 'transporte', 'saude',
     'educacao', 'lazer e cultura', 'viagens', 'vestuario e cuidados pessoais',
     'presentes, doacoes e transferencias'
   );

-- Ordem de exibicao na ordem em que o usuario as listou.
UPDATE categories c SET position = p.pos FROM (VALUES
  ('moradia', 10), ('servicos domesticos', 20), ('alimentacao', 30),
  ('transporte', 40), ('saude', 50), ('educacao', 60), ('lazer e cultura', 70),
  ('viagens', 80), ('vestuario e cuidados pessoais', 90),
  ('presentes, doacoes e transferencias', 100)
) AS p(nome, pos) WHERE lower(c.name) = p.nome;

-- Renda e Movimentacao continuam: nao sao categorias de gasto, sao o que separa
-- entrada e dinheiro trocando de bolso do que foi consumido. Some-las a lista de
-- despesa seria dizer que salario e um tipo de gasto.
UPDATE categories SET hint = 'entradas: salario, rendimento, reembolso recebido'
 WHERE lower(name) = 'renda';
UPDATE categories SET hint = 'dinheiro trocando de bolso: aplicacao, transferencia entre contas suas, pagamento de fatura'
 WHERE lower(name) = 'movimentacao';
