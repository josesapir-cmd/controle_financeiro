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

Quatro travas, porque leitura de imagem erra:

1. **Nada e gravado direto.** O lote fica em `shared_imports`, cifrado, com
   status `pendente`. Uma tela de conferencia mostra cada linha editavel; so
   confirmar grava. Numero errado no painel e pior do que numero ausente: uma
   vez gravado, ele se mistura ao extrato do banco e ninguem mais distingue.

   A tela e ordenada pelo trabalho que cada linha exige, nao pela ordem de
   leitura: **decidir** (repetidas entre envios, desmarcadas, fora dos totais),
   **conferir** (lidas sem confianca alta, ja marcadas) e o restante somado em
   bloco fechado. Uma lista unica com dezenas de linhas sem acao a tomar afoga
   as poucas que precisam de atencao — que e exatamente o que a revisao existe
   para pegar. Os tres blocos vivem no mesmo formulario, entao o fechado
   tambem e enviado. `classificarParaConferencia()` e a regra unica, usada
   tambem pela lista de importacoes.

   O envio e separado da aprovacao de proposito: fotografar a tela e coisa de
   celular, na hora; conferir valor por valor e coisa de tela grande. Por isso
   o envio nao leva a conferencia na marra, `/importar` lista o historico, e o
   painel avisa enquanto houver lote pendente — leitura esquecida e dinheiro
   que continua fora do controle.
2. **Identidade deterministica.** O id do lancamento e o HMAC de
   (dia, valor, descricao, n-esima ocorrencia identica). Prints que se sobrepoem
   atualizam em vez de duplicar. A ocorrencia e fixada na leitura e viaja pelo
   formulario de conferencia: reconta-la ali mudaria o id de uma linha so
   porque a identica ao lado foi desmarcada, orfanando o que ja foi gravado.
3. **Repeticao entre envios e apontada, nunca apagada.** Ver abaixo.
4. **Origem marcada.** `origin = 'manual'` em conta e lancamento, separando o
   que foi lido de imagem do que veio do Open Finance.

### Fila de envio, e o que ela obriga a decidir

Nao ha teto de imagens por vez. A tela quebra a selecao em blocos de quatro e
chama a rota uma vez por bloco, sempre para o mesmo lote. Duas razoes: uma
chamada com dezenas de imagens demora mais do que o limite de tempo da funcao, e
uma falha no fim perderia tudo que ja tinha sido lido — como o servidor guarda o
acumulado a cada bloco, uma queda no meio nao descarta nada e a fila retoma.

O bloco tem um efeito colateral util: dentro dele o modelo enxerga as telas
juntas e nao repete a linha que aparece em duas que se sobrepoem. Prints de
rolagem sao consecutivos, entao vizinhos caem no mesmo bloco e a maior parte das
sobreposicoes se resolve sozinha.

O que atravessa a fronteira entre blocos e detectado aqui: linha com **mesmo
dia, mesmo valor e mesma contraparte** vinda de **outro envio** e marcada como
possivel repeticao e chega desmarcada na conferencia, fora dos totais.

Ela nao e descartada, e a distincao importa. "Mesma data, mesmo valor, mesma
contraparte" tanto pode ser a mesma compra fotografada duas vezes quanto dois
cafes iguais na mesma padaria. Apagar o segundo caso em silencio tira dinheiro
do controle sem ninguem perceber — exatamente o que este recurso existe para
impedir. Repeticao dentro do mesmo envio nao e marcada: ali o modelo viu as duas
imagens de uma vez e ja teria unido o que fosse a mesma linha.

Os gastos entram numa conta virtual, "Saldo compartilhado (Nubank)". Ela nao
tem saldo apurado — ninguem nos informa quanto sobrou la — entao fica fora do
patrimonio liquido; participa dos lancamentos, do filtro e das contrapartes.
Com isso a transferencia mensal continua sendo movimentacao (nao despesa) e o
gasto real aparece uma vez so, com o nome do estabelecimento.

E uma ponte, nao a fonte definitiva: o arquivo do Poupa.ai preenchido pela
assistente traz as mesmas despesas ja categorizadas, e substitui a leitura por
foto quando for carregado.

### 6. Contraparte: nome oficial, apelido, e conciliacao de nomes recortados

A contraparte passa a ter dois nomes, porque sao duas coisas:

- **nome oficial** — como ela aparece no extrato. Serve para reconhecer e para
  conciliar.
- **apelido** — a abreviacao usada para falar dela ("Cascatinha").

Antes havia so o apelido, e ele *substituia* o nome do extrato na exibicao.
Batizar uma contraparte apagava a unica pista de qual lancamento era aquele.
Agora o apelido e o titulo e o nome oficial fica visivel abaixo.

**Conciliacao.** A tela do saldo compartilhado corta o nome do estabelecimento
("HOTEL FAZENDA CASC"); o mesmo gasto, quando chega pelo Open Finance, vem
inteiro ("HOTEL FAZENDA CASCATINHA LTDA"). Sao a mesma contraparte, e trata-las
como duas parte o historico e a classificacao em dois.

A comparacao mora na aplicacao, nao no SQL, e nao ha alternativa: o fingerprint
gravado e um HMAC, entao o banco nao tem como saber que um nome e comeco do
outro. `finance/conciliacao.ts` compara os nomes ja decifrados e sugere unioes;
o servico reescreve a chave da transacao antes de agregar.

As regras, e o que cada uma evita:

- direcao sempre do nome curto para o longo, e **nunca a partir de uma
  contraparte com documento**: CPF e CNPJ sao identidade forte, e dobra-los num
  casamento de nome trocaria uma identidade forte por uma fraca.
- prefixo minimo de 12 caracteres, ou 8 quando o proprio texto traz reticencias
  — ali ja sabemos que ha continuacao. "PADARIA" prefixa meia duzia de padarias
  diferentes.
- prefixo que serve a mais de um nome completo **nunca** vira uniao automatica:
  escolher no chute misturaria o gasto de dois lugares. Vira sugestao.
- toda uniao, automatica ou nao, fica visivel e reversivel na aba de
  contrapartes. A recusa tambem e gravada (destino nulo), senao a mesma
  sugestao voltaria para sempre.
- o rotulo segue a contraparte unida: classificacao feita antes da uniao nao se
  perde, porque perder trabalho ja feito e a maneira mais rapida de alguem parar
  de classificar.

As despesas lidas de print usam a **mesma** normalizacao de nome que o Open
Finance (`normalizeName`), entao nome identico pelas duas vias ja vira uma
contraparte so, sem depender de conciliacao. A conciliacao cobre so o caso do
nome cortado.

### 7. Categorias e centros de custo

Ate aqui categoria e subcategoria eram texto livre digitado por contraparte.
Rotular funcionava; planejar, nao. Texto livre nao tem identidade: renomear
"Viagem" exigiria reescrever cada linha, uma grafia diferente criava uma
categoria nova em silencio, e um centro de custo so passava a existir depois do
primeiro gasto — inutil para orcar a viagem do mes que vem.

Agora sao duas tabelas. **Categoria** e o nivel largo ("Viagem", "Familia");
**centro de custo** e a coisa concreta dentro dela ("Bariloche 2026", "Pai"),
com observacao, periodo e orcamento opcionais.

A semente sao as categorias do **Poupa.ai**, onde a assistente ja classifica os
gastos do saldo compartilhado: usar a mesma taxonomia dos dois lados evita
traduzir na hora de importar o arquivo dela. Duas correcoes em relacao ao
arquivo — "aulas / educacao" e "educacao" viram uma so, e "familia do jose" vira
"Familia". "Viagem" nao existe la e entra porque e o caso que motivou o recurso.

Decisoes que valem registro:

- **A taxonomia manda na tela.** Categoria e centro sem movimento no periodo
  aparecem zerados, nao somem. Orcamento que so aparece depois do primeiro gasto
  nao serve para planejar.
- **Digitar continua sendo a forma de classificar.** Os campos em Contrapartes
  seguem sendo texto com sugestao; ao salvar, o texto e resolvido para a
  taxonomia (acha ou cria, sem distinguir caixa). Trocar por uma lista de
  escolha seria mais lento e nao resolveria nada.
- **Arquivar, nunca apagar.** Apagar um centro levaria junto a classificacao de
  todas as contrapartes ligadas a ele — trabalho feito a mao. Arquivado, ele sai
  das listas e o historico continua somando onde sempre somou.
- **Gasto com categoria mas sem centro aparece a parte**, com o valor. E
  trabalho pela metade, e somar em silencio esconderia isso.
- O backfill da migracao transforma o que ja estava classificado em taxonomia,
  entao nada do que foi classificado a mao se perde.

### 8. O mapa do gasto e por que ele nao e colorido por categoria

A aba de categorias abre com um treemap: area proporcional ao gasto, categorias
subdivididas nos seus centros de custo.

**A cor carrega magnitude, nao identidade.** Um matiz por categoria pareceria
mais bonito e seria pior: sao 16 categorias, e nenhuma paleta separa 16 matizes
de forma confiavel para quem nao distingue cores. Num treemap o problema e maior
que numa barra empilhada — ali so os vizinhos se tocam, aqui qualquer bloco pode
encostar em qualquer outro, entao todos os pares precisariam passar. A paleta de
referencia valida no maximo tres nesse regime. Com um tom so, a identidade fica
onde e exata: escrita dentro do bloco e na tabela logo abaixo.

A rampa e um azul de quatro degraus, validada pelo verificador (monotonica,
degraus visiveis, ponta clara acima de 2:1 sobre branco). Cada degrau foi
escolhido para ter tinta de rotulo com contraste minimo de 6,2:1 — os degraus
intermediarios do azul nao alcancam 4,5:1 com branco nem com tinta escura, e
ficaram de fora por isso.

Outras decisoes:

- **O degrau vem da fatia do total, nao da posicao na lista.** Por posicao, o
  quinto maior gasto ficaria claro mesmo valendo quase tanto quanto o quarto, e
  a cor passaria a codificar ranking em vez do dado.
- **Receita e movimentacao nao entram no mapa.** Nao dividem o mesmo bolo que a
  despesa, e dar-lhes area no mesmo retangulo afirmaria que dividem.
- **O que cabe em cada bloco e decidido em pixels, pelo CSS**, com consulta de
  container. A primeira versao decidia em JavaScript comparando as unidades
  abstratas da caixa: os mesmos 12% viram 90px no computador e 45px no celular,
  entao o rotulo cabia num lugar e vazava no outro.
- **O nome da categoria e uma faixa dentro do grupo.** Solto acima dele, caia por
  cima do bloco vizinho — o mapa nao tem margem sobrando para pendurar texto.
- A tabela detalhada abaixo do mapa e a visao acessivel: todo valor esta la, com
  precisao, para quem nao le area.

### 9. Sistema visual

A referencia e a pagina de transacoes do template financeiro do AlignUI, conferida
contra o HTML dela. Tudo vive em `globals.css`, em tokens — nao ha CSS por
componente, e trocar a paleta e trocar o bloco `:root`.

O que a leitura da referencia corrigiu, depois de uma primeira versao feita de
memoria:

- **A pagina e branca.** O cinza (`--bg-weak`) aparece so onde marca alguma
  coisa: cabecalho de tabela, linha sob o cursor, aba ativa, trilho do
  segmentado. Fundo cinza com cartao branco por cima inverte a relacao e engorda
  a tela inteira.
- **Tabela sem grade.** O cabecalho e um bloco cinza de cantos arredondados nas
  pontas; as linhas nao tem borda, tem 48px de altura e acendem inteiras sob o
  cursor, tambem com as pontas arredondadas.
- **Cabecalho da tela e titulo pequeno sobre subtitulo** (18px medium), nao um
  titulo grande sozinho. O contexto — periodo, ultima sincronizacao — vira o
  subtitulo.
- **Item ativo da barra lateral e cinza com uma barrinha azul colada na borda
  esquerda**, e o rotulo continua na cor normal. Tingir o texto de azul, como na
  primeira versao, era invencao minha.

Duas regras que a paleta impoe:

- **Uma cor de acao.** O azul `--primary` e usado so por controles que agem.
  Nada decora com ele.
- **Cor de estado so comunica estado**, e nunca sozinha: linha repetida na
  conferencia tem fundo avermelhado *e* etiqueta escrita, valor negativo tem cor
  *e* sinal. Quem nao distingue as cores le a mesma informacao.

A navegacao usa a mesma marcacao em todas as larguras: barra lateral fixa a
partir de 1000px, pastilhas em linha entre 720 e 1000, barra inferior abaixo de
720. A diferenca esta toda no CSS — nao ha duas listas de links para manter em
sincronia, e os esqueletos de carregamento tambem renderizam a navegacao, senao
a barra lateral pisca a cada troca de aba.

A Inter e servida pelo proprio app: `next/font` a baixa no build e a hospeda no
nosso dominio. Um `<link>` para o Google Fonts entregaria o IP e o horario de
cada acesso a um terceiro, o que a secao seguinte proibe.

**O celular tem layout proprio, nao o desktop espremido.** Tabela de sete
colunas nao cabe em 390px, e rolagem horizontal esconde justamente as colunas de
valor. Abaixo de 720px cada linha vira um cartao com rotulo a esquerda e dado a
direita; o rotulo sai do `data-rotulo` da propria celula, entao o cabecalho pode
sumir sem que a leitura perca sentido. Os numeros do topo vao a dois por linha —
quatro cartoes de largura inteira viravam quatro telas de rolagem antes de o
painel comecar.

Cuidado que custou uma rodada: as regras de celular concorrem com as bases na
**mesma especificidade**, entao e a ordem de origem que decide. Escritas no meio
do arquivo, perdiam em silencio. Elas ficam no fim de `globals.css`, e e por
isso.

## O que nao muda

- Nenhum dado financeiro trafega para terceiros **exceto** os prints do saldo
  compartilhado, que o usuario envia deliberadamente para a API da Anthropic
  para serem lidos. Nao ha analytics, scripts externos nem CDN de fonte, e a
  imagem nao e guardada: cumprido o papel, so as linhas extraidas permanecem.
- O CPF do proprio usuario continua descartado na fronteira do servico, antes de
  chegar ao banco.
