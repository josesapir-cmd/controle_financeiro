-- Investimento nao e gasto.
--
-- Comprar um imovel de R$ 1.200.000 sai da conta como qualquer despesa, e o
-- extrato nao tem como saber a diferenca: para o banco e uma transferencia
-- grande. Mas somar isso ao gasto do mes torna todo o resto ilegivel — a
-- pergunta "quanto gastei" passa a ter uma resposta que nao ajuda ninguem.
--
-- O `kind` ja existia para isso: `receita` separa entrada, `movimentacao`
-- separa dinheiro trocando de bolso. `investimento` e um terceiro caso, e nao
-- um apelido dos outros dois: transferencia entre contas proprias volta, e
-- aporte vira patrimonio. A distincao vai importar na tela de patrimonio.
--
-- A posicao e 110, DEPOIS de todas as dez categorias de despesa. A bussola do
-- jogo so vale enquanto a mao decora as posicoes, e inserir no meio moveria
-- tudo o que vem depois — o custo seria pago por quem ja decorou.

INSERT INTO categories (name, kind, position, hue, hint) VALUES (
  'Investimentos',
  'investimento',
  110,
  200,
  'aporte que vira patrimonio: imovel, fundo, previdencia, compra de ativo'
)
ON CONFLICT (lower(name)) DO UPDATE
  SET kind = 'investimento',
      position = EXCLUDED.position,
      hint = EXCLUDED.hint,
      archived_at = NULL;
