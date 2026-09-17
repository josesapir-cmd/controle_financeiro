-- A taxa com que o papel esta marcado hoje.
--
-- A Pluggy manda `annualRate` para CDB e LCI, e manda nulo para Tesouro — e
-- justamente no Tesouro a taxa e a informacao que importa, porque e ela que
-- move o preco. Na tela isso aparecia como um traco.
--
-- A taxa tambem nao e uma so. Cada lote foi comprado a uma taxa (a contratada,
-- que e o que se recebe levando ao vencimento) e o mercado marca a posicao a
-- outra (a de hoje, que e o que se recebe vendendo agora). Sao numeros
-- diferentes e respondem perguntas diferentes; esta tabela guarda a segunda.
--
-- Guardada como TEXTO, e nao como numero. "IPCA + 7,02%" nao cabe num numeric
-- sem separar indice de cupom, e separar so para juntar de novo na hora de
-- exibir seria inventar estrutura para um dado que hoje so e lido. O preco
-- unitario, esse sim, e numero: com ele e a quantidade se recalcula a posicao.
--
-- `quoted_at` e obrigatorio. Taxa marcada envelhece em dias, e uma taxa de tres
-- meses atras ao lado de um saldo de hoje e pior que nenhuma taxa.

CREATE TABLE IF NOT EXISTS instrument_quotes (
  -- Fingerprint do nome exibido — depois do apelido, quando ha apelido. Uma
  -- cotacao por instrumento na tela, que e como a pessoa pensa nele.
  fingerprint  text PRIMARY KEY,
  -- O que aparece na coluna: "IPCA + 7,02%", "110% do CDI", "12,5% a.a.".
  rate_label   text NOT NULL,
  -- Preco unitario, quando a fonte informa. No Tesouro sai direto da tela.
  unit_price   numeric(18, 6),
  quoted_at    date NOT NULL,
  -- De onde veio: "tela de compra do Tesouro Direto", "relatorio mensal".
  note_enc     text,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
