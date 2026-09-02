-- "Vestuario e Cuidados Pessoais" passa a se chamar "Compras".
--
-- Renomear categoria nao e um UPDATE de uma linha so, por dois motivos que ja
-- derrubaram uma migracao aqui antes:
--
-- 1. O nome e unico ignorando caixa, e existe uma categoria "Compras" ARQUIVADA
--    — ela veio das dezesseis do Poupa.ai e a migracao 008 a arquivou por nao
--    ter sucessora. O indice nao ignora arquivadas, entao o UPDATE direto
--    esbarraria nela.
-- 2. `counterparty_labels.category` guarda o NOME em texto, nao o id. Renomear
--    a categoria sem mexer nesse texto quebraria a heranca de rotulo de toda
--    contraparte classificada nela: o app procura a categoria pelo nome e nao
--    acharia mais.

-- ---------------------------------------------------------------------------
-- 1. Libera o nome, sem destruir nada.
--
--    Os centros de custo da "Compras" arquivada vao para a categoria que
--    sobrevive. Nome repetido entre as duas nao pode gerar duas linhas: o
--    indice de centro e unico por (categoria, nome), entao a que ja pertence ao
--    destino vence e a outra e absorvida.
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE renomeada ON COMMIT DROP AS
SELECT id FROM categories WHERE lower(name) = 'vestuario e cuidados pessoais';

CREATE TEMP TABLE antiga ON COMMIT DROP AS
SELECT id FROM categories
 WHERE lower(name) = 'compras'
   AND id NOT IN (SELECT id FROM renomeada);

-- Centro cujo nome ja existe no destino: os lancamentos passam para o de la, e
-- o duplicado sai. Sem isto o UPDATE de category_id violaria o indice.
CREATE TEMP TABLE centro_duplicado ON COMMIT DROP AS
SELECT velho.id AS origem_id, novo.id AS destino_id
  FROM cost_centers velho
  JOIN cost_centers novo
    ON novo.category_id = (SELECT id FROM renomeada)
   AND lower(novo.name) = lower(velho.name)
 WHERE velho.category_id = (SELECT id FROM antiga);

UPDATE transaction_labels t
   SET cost_center_id = d.destino_id
  FROM centro_duplicado d WHERE t.cost_center_id = d.origem_id;

UPDATE counterparty_labels l
   SET cost_center_id = d.destino_id
  FROM centro_duplicado d WHERE l.cost_center_id = d.origem_id;

DELETE FROM cost_centers WHERE id IN (SELECT origem_id FROM centro_duplicado);

UPDATE cost_centers
   SET category_id = (SELECT id FROM renomeada)
 WHERE category_id = (SELECT id FROM antiga);

UPDATE transaction_labels
   SET category_id = (SELECT id FROM renomeada)
 WHERE category_id = (SELECT id FROM antiga);

-- Agora ela nao carrega mais nada; o nome pode sair. Renomear em vez de apagar
-- porque apagar categoria e uma porta so de ida, e nao ha ganho nenhum em
-- atravessa-la aqui: arquivada, ela nao aparece em tela nenhuma.
UPDATE categories
   SET name = 'Compras (arquivada em 2026)', archived_at = coalesce(archived_at, now())
 WHERE id IN (SELECT id FROM antiga);

-- ---------------------------------------------------------------------------
-- 2. O nome novo, e o texto que aponta para ele.
-- ---------------------------------------------------------------------------
UPDATE categories
   SET name = 'Compras'
 WHERE id IN (SELECT id FROM renomeada);

UPDATE counterparty_labels
   SET category = 'Compras'
 WHERE lower(trim(category)) = 'vestuario e cuidados pessoais';
