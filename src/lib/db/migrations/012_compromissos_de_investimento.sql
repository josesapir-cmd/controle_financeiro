-- Compromissos de capital em fundos, e as chamadas que os consomem.
--
-- Um compromisso e uma promessa: "assinei R$ 500 mil no fundo X". O dinheiro
-- nao sai na assinatura — o gestor chama pedacos dele quando encontra o que
-- comprar, sem periodicidade nenhuma. Entre a assinatura e a ultima chamada
-- podem passar anos, e a pergunta que importa no meio do caminho e sempre a
-- mesma: quanto ainda pode ser chamado sem aviso?
--
-- Por isso sao duas tabelas e nao um saldo. Um numero unico ("ja integralizei
-- 240 mil") responde ao passado e esconde o futuro; a lista de chamadas mantem
-- as duas respostas, e a segunda — o que falta — e a unica que exige caixa
-- disponivel.
--
-- Nada aqui e cifrado. Nome de fundo e valor de compromisso nao sao dado de
-- terceiro nem credencial: sao os proprios numeros que a tela agrupa e soma, e
-- cifra-los custaria toda a agregacao em SQL sem proteger nada que ja nao
-- esteja protegido pelo acesso ao banco.

CREATE TABLE IF NOT EXISTS fund_commitments (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  -- Valor total prometido. Positivo: e compromisso, nao lancamento.
  committed  numeric(18, 2) NOT NULL CHECK (committed > 0),
  -- Quando o compromisso foi assinado. Opcional: nem sempre se lembra, e o
  -- numero funciona sem ela.
  signed_on  date,
  note       text,
  -- Compromisso encerrado — chamado por inteiro, ou cancelado. Some da tela
  -- ativa sem perder o historico das chamadas que ja aconteceram.
  closed_at  timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Nome unico ignorando caixa, como em categories: dois "Fundo X" na lista sao
-- sempre erro de digitacao, e somar duas linhas que deveriam ser uma esconde
-- justamente o que a tela existe para mostrar.
CREATE UNIQUE INDEX IF NOT EXISTS fund_commitments_nome_idx
  ON fund_commitments (lower(name));

CREATE TABLE IF NOT EXISTS capital_calls (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  commitment_id uuid NOT NULL REFERENCES fund_commitments(id) ON DELETE CASCADE,
  -- A data em que a chamada foi paga (ou tem de ser paga). E por ela que a
  -- lista se ordena, e nao pela ordem de digitacao: chamada antiga lembrada
  -- depois tem de cair no lugar certo.
  called_on     date NOT NULL,
  amount        numeric(18, 2) NOT NULL CHECK (amount > 0),
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS capital_calls_compromisso_idx
  ON capital_calls (commitment_id, called_on);
