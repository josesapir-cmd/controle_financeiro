# Arquitetura

Decisoes tomadas ao levar o app para a nuvem. Registradas aqui porque as razoes
importam mais que as escolhas: quem mexer nisto depois precisa saber o que foi
descartado e por que.

## Contexto

App de financas pessoais de um unico usuario, consumindo Open Finance pela
Pluggy. Ate aqui rodava em localhost, buscando tudo da API a cada renderizacao,
sem persistencia e sem autenticacao — o `localhost` era a fronteira de
seguranca.

Levar para a nuvem muda a natureza do problema. O dado deixa de estar num
diretorio da maquina do usuario e passa a estar num servico alcancavel pela
internet, onde um erro de configuracao expoe o historico financeiro inteiro.

## O ativo mais sensivel nao e o banco de dados

E o `PLUGGY_CLIENT_SECRET`. O banco guarda o passado; a credencial da acesso ao
presente e ao futuro, direto na Pluggy, sem passar pelo app. Consequencias:

- Vive apenas no cofre de variaveis da plataforma. Nunca no repositorio, nunca
  em log, nunca em mensagem de erro exibida ao usuario.
- Precisa ser rotacionavel em minutos, sem redeploy de codigo.
- Nenhuma rota do app a expoe, direta ou indiretamente.

## Decisoes

### 1. Hospedagem: Vercel + Neon, regiao Sao Paulo

Vercel e nativo para Next.js: deploy por git push, HTTPS, cofre de segredos e
cron agendado sem infraestrutura propria. Neon e Postgres serverless com regiao
em Sao Paulo (`sa-east-1`), o que mantem latencia baixa e os dados no pais.

Descartado **VPS proprio**: controle total vem junto com responsabilidade total
por patches, firewall, certificado, backup e monitoramento — numa maquina que
guarda extrato bancario. Para um projeto de uma pessoa, e mais superficie de
erro que ganho.

Descartado **Fly.io**: melhor para sincronizacoes longas e um fornecedor so, mas
exige administrar atualizacao e backup, e custa mesmo parado.

Limitacao aceita: o job de sincronizacao tem teto de tempo por execucao na
Vercel. A sincronizacao e incremental e por conexao justamente para caber nesse
teto; se um dia nao couber, o caminho e mover o job para uma maquina dedicada,
sem mexer no resto.

### 2. Autenticacao: passkey (WebAuthn)

Sem senha e sem segredo compartilhado: nao ha o que vazar, e e resistente a
phishing. Para um app de um usuario, o custo de implementacao e baixo.

Descartado **link magico por e-mail**: transfere a seguranca do app para a caixa
de entrada, que e um alvo maior e mais exposto.

Descartado **login com Google**: rapido, mas amarra a seguranca do app a uma
conta de terceiro e entrega ao Google o registro de quando o usuario acessa suas
financas.

Registro de mais de um dispositivo desde o inicio, mais um codigo de recuperacao
guardado offline: perder o unico dispositivo nao pode significar perder o acesso.

### 3. Criptografia: campos identificadores cifrados na aplicacao

AES-256-GCM na aplicacao, com chave no cofre da plataforma, sobre os campos que
identificam pessoas e contas: descricao do lancamento, nome e documento da
contraparte, numero de conta, apelidos do cadastro.

Valores, datas, categorias e tipos ficam em claro, porque sao o que as telas
agregam — cifra-los levaria toda soma e ordenacao para a memoria do app.

O ponto: a criptografia do provedor protege contra roubo de disco, nao contra
quem obtiver acesso de leitura ao banco. Neste desenho, quem le o banco sem a
chave ve **quanto** e **quando**, mas nao **de quem** nem **do que**.

Descartado **cifrar tudo, inclusive valores**: viável no volume atual, mas
transforma consultas triviais em varreduras completas e torna o codigo fragil.

Descartado **so a criptografia do provedor**: nao protege o caso mais provavel
de vazamento, que e credencial de banco exposta.

### 4. Leitura vem do banco, nunca da API

O app deixa de chamar a Pluggy durante a renderizacao. Um job agendado
sincroniza Pluggy → banco; as telas leem so do banco.

Tres razoes, em ordem de importancia:

1. **Durabilidade.** Desabilitar uma conexao no Meu Pluggy, o consentimento de
   Open Finance vencer (12 meses) ou recriar uma conexao — que gera `itemId`
   novo — hoje apagariam o historico. Passam a nao apagar.
2. **Velocidade.** A tela deixa de esperar varias chamadas de rede em serie.
3. **Resiliencia.** Uma conexao com problema para de derrubar a experiencia
   inteira; o dado da ultima sincronizacao continua la, com a data explicita.

Consequencia de projeto: a identidade de uma conta deixa de ser o `itemId`.
Reconectar um banco gera item novo, e amarrar o historico a ele o orfanaria.
A chave passa a ser instituicao + numero da conta.

### 5. Saldo compartilhado: print lido por modelo, conferido antes de gravar

O saldo compartilhado do Nubank nao existe no Open Finance. A conta corrente
mostra so a transferencia mensal com o valor cheio — no periodo levantado,
R$ 1,08 milhao em `Transfer - Internal` — e cada compra acontece do outro lado,
invisivel para a API. Conectar a conta da assistente nao resolveu: os gastos nao
aparecem no Open Finance dela tambem.

Esse dinheiro e do usuario. As saidas nao podem sumir do controle so porque a
API nao as entrega, nem podem ser substituidas pela transferencia — que diz
quanto saiu, mas nao o que foi comprado. Entao ha um caminho de entrada por
foto da tela: as imagens vao para a API da Anthropic (`claude-opus-5`), que
devolve as linhas em JSON.

Tres travas, porque leitura de imagem erra:

1. **Nada e gravado direto.** O lote fica em `shared_imports`, cifrado, com
   status `pendente`. Uma tela de conferencia mostra cada linha editavel; so
   confirmar grava. Numero errado no painel e pior do que numero ausente: uma
   vez gravado, ele se mistura ao extrato do banco e ninguem mais distingue.
2. **Identidade deterministica.** O id do lancamento e o HMAC de
   (dia, valor, descricao, n-esima ocorrencia identica). Prints que se sobrepoem
   atualizam em vez de duplicar.
3. **Origem marcada.** `origin = 'manual'` em conta e lancamento, separando o
   que foi lido de imagem do que veio do Open Finance.

Os gastos entram numa conta virtual, "Saldo compartilhado (Nubank)". Ela nao
tem saldo apurado — ninguem nos informa quanto sobrou la — entao fica fora do
patrimonio liquido; participa dos lancamentos, do filtro e das contrapartes.
Com isso a transferencia mensal continua sendo movimentacao (nao despesa) e o
gasto real aparece uma vez so, com o nome do estabelecimento.

E uma ponte, nao a fonte definitiva: o arquivo do Poupa.ai preenchido pela
assistente traz as mesmas despesas ja categorizadas, e substitui a leitura por
foto quando for carregado.

## O que nao muda

- Nenhum dado financeiro trafega para terceiros **exceto** os prints do saldo
  compartilhado, que o usuario envia deliberadamente para a API da Anthropic
  para serem lidos. Nao ha analytics, scripts externos nem CDN de fonte, e a
  imagem nao e guardada: cumprido o papel, so as linhas extraidas permanecem.
- O CPF do proprio usuario continua descartado na fronteira do servico, antes de
  chegar ao banco.
