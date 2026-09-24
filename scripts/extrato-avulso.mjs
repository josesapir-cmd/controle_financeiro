#!/usr/bin/env node
/**
 * Baixa uma conexao inteira da Pluggy para arquivos, FORA deste projeto.
 *
 * Existe para o caso em que a pergunta nao e "como esta minha carteira" e sim
 * "o que aconteceu com esse dinheiro". A conta pode nem ser sua: uma conexao de
 * terceiro entra no seu Pluggy, sai daqui em CSV, e nada disso encosta no banco
 * do app — este arquivo nao importa `conectar.mjs` nem o repositorio, entao nao
 * ha caminho possivel ate o Postgres. O padrao de saida e `~/extrato-pluggy`, e
 * gravar dentro do projeto e recusado: dado de outra pessoa nao mora num repo
 * que sobe sozinho a cada push.
 *
 * O que ele monta, alem do despejo cru:
 *
 *   - a JANELA que a instituicao entregou de verdade. O Open Finance costuma
 *     dar 12 meses de extrato, nao a vida toda da conta. Se o dinheiro saiu
 *     antes disso, nenhum script acha — e saber disso e o comeco da resposta,
 *     nao o fim dela.
 *   - o saldo implicito no inicio da janela (saldo de hoje menos o que entrou,
 *     mais o que saiu). E o numero que separa "sumiu" de "nao estou vendo": se
 *     ele ja bate com o que a pessoa lembra, o dinheiro saiu dentro da janela e
 *     esta nas linhas abaixo. Se ele ja vem baixo, a conta foi esvaziada antes
 *     do que o banco mostra aqui.
 *   - as saidas agrupadas por contraparte, que e onde aparece o mesmo nome
 *     recebendo dezenas de vezes.
 *   - o que foi para aplicacao e caixinha separado do resto, porque isso nao e
 *     dinheiro que sumiu: e dinheiro que mudou de bolso e continua sendo dela.
 *
 * Uso:
 *   node scripts/extrato-avulso.mjs <itemId>
 *   node scripts/extrato-avulso.mjs <itemId> --saida ~/algum/lugar
 *   node scripts/extrato-avulso.mjs <itemId> --sondar   mapeia a API e sai
 */

import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const API = process.env.PLUGGY_API_URL || "https://api.pluggy.ai";

/* -------------------------------------------------------------------------- */
/* Ambiente e argumentos                                                      */
/* -------------------------------------------------------------------------- */

async function lerEnv() {
  for (const arquivo of [".env.local", ".env"]) {
    try {
      const conteudo = await readFile(path.join(process.cwd(), arquivo), "utf8");
      for (const linha of conteudo.split("\n")) {
        const limpa = linha.trim();
        if (!limpa || limpa.startsWith("#")) continue;
        const igual = limpa.indexOf("=");
        if (igual === -1) continue;
        const chave = limpa.slice(0, igual).trim();
        if (!process.env[chave]) {
          process.env[chave] = limpa.slice(igual + 1).trim().replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

const argumentos = process.argv.slice(2);
const opcao = (nome) => {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? null : (argumentos[i + 1] ?? null);
};

const itemId = argumentos.find((a) => !a.startsWith("--") && a !== opcao("saida"));

if (!itemId) {
  console.error(
    "Falta o id da conexao.\n\n" +
      "  node scripts/extrato-avulso.mjs <itemId>\n\n" +
      "O id esta na URL do painel da Pluggy:\n" +
      "  https://meu.pluggy.ai/connections/SEU-ID-AQUI",
  );
  process.exit(1);
}

/* -------------------------------------------------------------------------- */
/* Chamadas                                                                   */
/* -------------------------------------------------------------------------- */

let apiKey = null;

async function autenticar() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error(
      "PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET precisam estar no .env.local.",
    );
  }

  const resposta = await fetch(`${API}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!resposta.ok) {
    throw new Error(`/auth respondeu HTTP ${resposta.status}: ${await resposta.text()}`);
  }

  apiKey = (await resposta.json()).apiKey;
}

/** Uma chamada GET. `tolerar` lista status que devolvem null em vez de estourar. */
async function pegar(caminho, tolerar = []) {
  const resposta = await fetch(`${API}${caminho}`, { headers: { "X-API-KEY": apiKey } });

  if (tolerar.includes(resposta.status)) return null;
  if (!resposta.ok) {
    throw new Error(`GET ${caminho} respondeu HTTP ${resposta.status}: ${await resposta.text()}`);
  }
  return resposta.json();
}

/**
 * Bate numa rota so para saber o que ela responde.
 *
 * Serve ao modo --sondar: quando um produto aparece em `item.products` e o
 * script nao acha o endereco dele, o que resolve nao e chutar de novo no
 * escuro — e mapear a API de uma vez e ver qual porta abre.
 */
async function sondar(caminho) {
  try {
    const resposta = await fetch(`${API}${caminho}`, { headers: { "X-API-KEY": apiKey } });
    const texto = await resposta.text();
    let quantos = null;
    try {
      const corpo = JSON.parse(texto);
      const itens = corpo.results ?? corpo.data ?? (Array.isArray(corpo) ? corpo : null);
      if (Array.isArray(itens)) quantos = itens.length;
    } catch {}
    return { caminho, status: resposta.status, quantos, amostra: texto.slice(0, 120) };
  } catch (erro) {
    return { caminho, status: 0, quantos: null, amostra: String(erro.message).slice(0, 120) };
  }
}

/**
 * Tenta uma lista de caminhos e devolve o primeiro que responder.
 *
 * Existe porque a documentacao da Pluggy nao esta ao alcance de quem roda isto
 * offline, e chutar UM caminho e errar significa um produto inteiro faltando em
 * silencio — foi o que aconteceu: a conexao trazia nota de corretagem e
 * emprestimo, e o script nem perguntava. Errar a rota agora custa um 404
 * anotado no relatorio, e nao um buraco que ninguem ve.
 */
async function primeiroQueResponder(nome, caminhos) {
  for (const caminho of caminhos) {
    const corpo = await pegar(caminho, [400, 403, 404, 405, 501]);
    if (corpo) {
      const itens = corpo.results ?? corpo.data ?? (Array.isArray(corpo) ? corpo : [corpo]);
      return { nome, caminho, itens: Array.isArray(itens) ? itens : [itens] };
    }
  }
  return { nome, caminho: null, itens: [] };
}

/**
 * Todas as paginas de lancamentos de uma conta.
 *
 * A v2 devolve `next` ja como query string pronta — nao e o valor de um
 * parametro `cursor`, e trata-lo assim faz a API responder 400. E ela nao
 * aceita filtro de data, entao "todo o historico" aqui e literalmente seguir o
 * `next` ate o fim, que e justamente o que se quer neste script.
 */
async function todosOsLancamentos(accountId) {
  const todos = [];
  let caminho = `/v2/transactions?accountId=${encodeURIComponent(accountId)}`;

  for (let pagina = 0; pagina < 2000; pagina += 1) {
    const corpo = await pegar(caminho);
    const resultados = corpo?.results ?? corpo?.data ?? corpo?.transactions ?? [];
    todos.push(...resultados);

    if (process.stdout.isTTY) process.stdout.write(`\r    ${todos.length} lancamento(s)...`);

    const proximo = typeof corpo?.next === "string" && corpo.next ? corpo.next : null;
    if (resultados.length === 0 || !proximo) break;
    caminho = `/v2/transactions${proximo}`;
  }

  if (process.stdout.isTTY) process.stdout.write("\r\x1b[K");
  return todos;
}

/* -------------------------------------------------------------------------- */
/* Formatacao                                                                 */
/* -------------------------------------------------------------------------- */

const dinheiro = (v) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const dia = (v) => (typeof v === "string" ? v.slice(0, 10) : "");

const documento = (d) => {
  const so = String(d ?? "").replace(/\D/g, "");
  if (so.length === 11) return `***.${so.slice(3, 6)}.${so.slice(6, 9)}-**`;
  if (so.length === 14) return `${so.slice(0, 2)}.${so.slice(2, 5)}.${so.slice(5, 8)}/****-**`;
  return so || "";
};

/**
 * Quem esta do outro lado: numa saida e quem recebeu, numa entrada quem pagou.
 *
 * Devolve o documento nas duas formas. O resumo usa o mascarado, porque e o
 * arquivo que se mostra para alguem. O CSV usa o inteiro, porque e a peca de
 * prova: um CPF pela metade nao serve para o banco nem para um boletim de
 * ocorrencia, e esconde-lo ali seria so teatro — o `bruto.json` ao lado tem
 * tudo, e os dois arquivos ficam fora do projeto, no seu disco.
 */
function contraparte(t) {
  const saida = (t.amount ?? 0) < 0;
  const outro = saida ? t.paymentData?.receiver : t.paymentData?.payer;
  const proprio = saida ? t.paymentData?.payer : t.paymentData?.receiver;

  const soDigitos = (v) => String(v ?? "").replace(/\D/g, "");
  const doc = soDigitos(outro?.documentNumber?.value);
  const docDoTitular = soDigitos(proprio?.documentNumber?.value);

  // MESMO documento dos dois lados: a transferencia foi para uma conta da
  // propria pessoa em outro banco. Nao e dinheiro saindo, e dinheiro mudando de
  // endereco — e chamar isso de "terceiro" numa apuracao de familia e acusar
  // alguem que nao fez nada. Que o documento do recebedor e real, e nao eco do
  // pagador, se comprova nas linhas em que ele DIFERE: a Pluggy preenche o
  // documento verdadeiro de quem recebe quando ele e outro.
  const propria = Boolean(doc && docDoTitular && doc === docDoTitular);

  // O nome do recebedor vem nulo em PIX entre contas proprias; a descricao do
  // Nubank carrega o nome depois de uma barra.
  const daDescricao = (t.description ?? "").split("|")[1]?.trim();
  const nome = outro?.name?.trim() || daDescricao || "";

  if (!nome && !doc) return { nome: "(nao identificada)", doc: "", docInteiro: "", propria: false };

  const banco = outro?.routingNumber
    ? `banco ${outro.routingNumber}${outro.branchNumber ? ` ag ${outro.branchNumber}` : ""}` +
      `${outro.accountNumber ? ` cc ${outro.accountNumber}` : ""}`
    : "";

  return {
    nome: nome || "(sem nome)",
    doc: documento(doc),
    docInteiro: doc,
    propria,
    banco,
  };
}

/**
 * Aplicacao, resgate e caixinha.
 *
 * Heuristica sobre o texto, e nao classificacao do banco — por isso o relatorio
 * diz que e heuristica e manda conferir no CSV. Errar para mais aqui e barato:
 * a linha continua aparecendo em todas as outras secoes.
 */
const MUDA_DE_BOLSO =
  /aplica|resgate|caixinha|rdb|cdb|poupan|invest|reserva|tesouro|cofrinho|rendimento/i;

const mudouDeBolso = (t) =>
  contraparte(t).propria ||
  MUDA_DE_BOLSO.test(`${t.description ?? ""} ${t.descriptionRaw ?? ""} ${t.category ?? ""}`);

const csv = (linhas) =>
  linhas
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\n");

/* -------------------------------------------------------------------------- */
/* Relatorio                                                                  */
/* -------------------------------------------------------------------------- */

function montarResumo({ item, contas, lancamentosPorConta, investimentos, movimentos, extras }) {
  const linhas = [];
  const p = (...t) => linhas.push(t.join(""));

  const todos = [...lancamentosPorConta.values()].flat();
  const ordenados = [...todos].sort((a, b) => dia(a.date).localeCompare(dia(b.date)));
  const primeiro = ordenados[0] ? dia(ordenados[0].date) : null;
  const ultimo = ordenados.at(-1) ? dia(ordenados.at(-1).date) : null;

  p(`# Extrato de ${item?.connector?.name ?? "conexao"} — conexao ${itemId}`);
  p();
  p(`Gerado em ${new Date().toISOString().slice(0, 16).replace("T", " ")}.`);
  p();

  /* --- o que o banco entregou --------------------------------------------- */

  p("## O que a instituicao entregou");
  p();
  p(`- Status da conexao: **${item?.status ?? "?"}**`);
  p(`- Ultima atualizacao na Pluggy: ${item?.lastUpdatedAt ?? "?"}`);
  p(`- Contas: ${contas.length} · Lancamentos: ${todos.length} · Investimentos: ${investimentos.length}`);

  if (primeiro && ultimo) {
    const meses = Math.round(
      (Date.parse(`${ultimo}T00:00:00Z`) - Date.parse(`${primeiro}T00:00:00Z`)) / 2_592_000_000,
    );
    p(`- Janela coberta: **${primeiro} a ${ultimo}** (cerca de ${meses} meses)`);
    p();
    // O teto de doze meses e do Open Finance e vale sempre. Mas uma janela que
    // COMECA depois desse teto nao quer dizer, sozinha, que o extrato veio
    // cortado: numa conta que so se mexe quando algo vence, os meses antes do
    // primeiro vencimento sao vazios de verdade. Dizer "faltou dado" nos dois
    // casos assusta a toa; dizer qual e qual custa duas linhas.
    const limite = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);
    p();
    p(`> **O teto e 12 meses.** Antes de ${limite} o Open Finance nao entrega extrato,`);
    p("> entao o que aconteceu antes disso nao esta aqui — e nao porque nao existiu.");
    if (primeiro > limite) {
      p(`> Esta coleta comeca depois disso, em ${primeiro}. Pode ser corte do banco, ou`);
      p("> pode ser que nao houve movimento nenhum no comeco da janela: compare com a");
      p("> primeira data da secao **A historia das posicoes** antes de concluir.");
    }
    p("> Para ir mais para tras, o caminho e pedir o extrato completo ao banco, que e");
    p("> direito do titular — nao ha script que contorne isso.");
  } else {
    p("- Janela coberta: **nenhum lancamento veio**");
  }

  const detalhe = item?.statusDetail;
  if (detalhe && typeof detalhe === "object") {
    const comProblema = Object.entries(detalhe).filter(
      ([, v]) => v && typeof v === "object" && v.isUpdated === false,
    );
    if (comProblema.length > 0) {
      p();
      p("- Produtos que **nao** vieram completos nesta coleta:");
      for (const [nome, v] of comProblema) {
        p(
          `  - ${nome} — ultima coleta com sucesso: ${v.lastUpdatedAt ?? "nunca"}` +
            (v.warnings ? ` · ${JSON.stringify(v.warnings)}` : ""),
        );
      }
    }
  }
  p();

  /* --- a coleta foi exaustiva? ------------------------------------------- */

  // A pergunta que derrubou a primeira versao deste script: "e se estiver
  // faltando alguma coisa?". O `item.products` diz o que a conexao carrega. Se
  // o relatorio nao comparar isso com o que ele foi buscar, quem le nao tem
  // como saber que um produto inteiro ficou de fora — e foi o que aconteceu com
  // nota de corretagem e emprestimo.
  const carregados = (item?.products ?? []).map((x) => String(x).toUpperCase());
  if (carregados.length > 0) {
    // O que este script cobre, por produto do item.
    const cobertura = {
      ACCOUNTS: contas.length > 0 ? `${contas.length} conta(s)` : "nenhuma conta voltou",
      TRANSACTIONS: `${todos.length} lancamento(s)`,
      INVESTMENTS: `${investimentos.length} posicao(oes)`,
      INVESTMENTS_TRANSACTIONS: `${(movimentos ?? []).length} movimento(s)`,
      PAYMENT_DATA: "vem dentro de cada lancamento",
    };
    const porNome = new Map((extras ?? []).map((e) => [e.nome, e]));
    const doExtra = (nome, produto) => {
      const e = porNome.get(nome);
      if (!e) return;
      cobertura[produto] = e.caminho
        ? `${e.itens.length} item(ns)`
        : "**barrado (403) ou rota desconhecida — veja `--sondar`**";
    };
    doExtra("identidade", "IDENTITY");
    doExtra("emprestimos", "LOANS");
    doExtra("notas de corretagem", "BROKERAGE_NOTE");
    doExtra("beneficios", "BENEFITS");

    const faturas = (extras ?? []).filter((e) => e.nome.startsWith("faturas do cartao"));
    if (faturas.length > 0) {
      const total = faturas.reduce((s, f) => s + f.itens.length, 0);
      cobertura.CREDIT_CARDS = `${total} fatura(s)`;
    }

    p("## A coleta foi exaustiva?");
    p();
    p("A conexao declara o que carrega. Esta tabela compara com o que foi pedido:");
    p();
    p("| Produto que a conexao tem | O que voltou |");
    p("|---|---|");
    const faltando = [];
    for (const produto of carregados) {
      const tem = cobertura[produto];
      if (tem === undefined) faltando.push(produto);
      p(`| ${produto} | ${tem ?? "**NAO FOI BUSCADO por este script**"} |`);
    }
    p();
    if (faltando.length > 0) {
      p(`> **${faltando.length} produto(s) sem cobertura:** ${faltando.join(", ")}.`);
      p("> A conexao tem esse dado e este script nao foi busca-lo. Se a pergunta for");
      p("> para onde o dinheiro foi, isso e buraco — nao conclua nada sem fechar.");
    } else {
      const barrados = Object.entries(cobertura).filter(
        ([produto, texto]) => carregados.includes(produto) && String(texto).includes("barrado"),
      );
      if (barrados.length > 0) {
        p(`> **${barrados.length} produto(s) a conexao COLETOU e este acesso nao le:** ` +
          barrados.map(([k]) => k).join(", ") + ".");
        p("> A diferenca importa: 403 nao e dado inexistente, e dado existente do outro");
        p("> lado de uma porta fechada — quase sempre produto que o plano da Pluggy nao");
        p("> inclui. O dado esta la. Apagar a conexao destroi o que nao foi lido, e");
        p("> refaze-la exige o titular consentindo de novo.");
      } else {
        p("Todo produto que a conexao carrega foi pedido e respondeu. O que nao esta");
        p("aqui nao esta na conexao — a proxima parada e o banco, nao outro script.");
      }
    }
    p();
    p("Isto cobre o que a CONEXAO tem. O consentimento do Open Finance pode ter sido");
    p("dado para menos produtos do que a instituicao oferece: compare a lista acima");
    p("com `connector.products` no bruto.json — se faltar produto ali, o caminho e");
    p("refazer o consentimento pedindo tudo.");
    p();
  }

  /* --- contas e a conferencia do saldo ------------------------------------ */

  p("## Contas e conferencia do saldo");
  p();

  for (const conta of contas) {
    const lancamentos = lancamentosPorConta.get(conta.id) ?? [];
    const entradas = lancamentos.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
    const saidas = lancamentos.filter((t) => t.amount < 0).reduce((s, t) => s + t.amount, 0);
    const inicio = (conta.balance ?? 0) - entradas - saidas;

    p(`### ${conta.name ?? conta.type} · ${conta.number ?? ""}`);
    p();
    p("| | |");
    p("|---|---:|");
    p(`| Saldo hoje | ${dinheiro(conta.balance)} |`);
    p(`| Entradas na janela | ${dinheiro(entradas)} |`);
    p(`| Saidas na janela | ${dinheiro(saidas)} |`);
    p(`| **Saldo no inicio da janela** | **${dinheiro(inicio)}** |`);
    p();
    p("O saldo no inicio e deduzido, nao informado: e o saldo de hoje desfazendo");
    p("tudo o que entrou e saiu. Se ele ja for baixo, a conta foi esvaziada ANTES");
    p("do periodo que o banco mostra aqui, e a resposta nao esta neste arquivo.");
    p();

    if (inicio < 0) {
      p("> **Este numero deu negativo, e isso nao e um saldo.** Uma conta nao");
      p("> comeca devendo por conta propria. Deu negativo porque saiu mais dinheiro");
      p("> do que os lancamentos recebidos explicam — ou seja, **faltam lancamentos**:");
      p("> o banco entregou o extrato pela metade, ou o saldo de hoje nao e da mesma");
      p("> data. Nao tire conclusao daqui; peca o extrato completo ao banco.");
      p();
    }
  }

  /* --- investimentos ------------------------------------------------------ */

  if (investimentos.length > 0) {
    const bruto = investimentos.reduce((s, i) => s + (i.amount ?? 0), 0);
    const liquido = investimentos.reduce((s, i) => s + (i.balance ?? i.amount ?? 0), 0);

    p("## Investimentos");
    p();
    p(`Total bruto ${dinheiro(bruto)} · liquido de imposto ${dinheiro(liquido)}.`);
    p();
    p("| Papel | Tipo | Aportado | Bruto hoje | Liquido |");
    p("|---|---|---:|---:|---:|");
    for (const i of [...investimentos].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))) {
      p(
        `| ${i.name ?? "-"} | ${i.type ?? ""}${i.subtype ? ` / ${i.subtype}` : ""} ` +
          `| ${dinheiro(i.amountOriginal)} | ${dinheiro(i.amount)} | ${dinheiro(i.balance)} |`,
      );
    }
    p();
    p("Este dinheiro **nao sumiu**: ele saiu da conta corrente e continua sendo dela.");
    p("Vale somar com o saldo das contas antes de concluir qualquer coisa.");
    p();
  }

  /* --- a historia das posicoes, que vai muito alem da janela ------------- */

  // O extrato para em doze meses; a POSICAO carrega a data em que foi comprada.
  // E por aqui que se enxerga tres, cinco anos atras — e e a unica coisa nesta
  // coleta que responde "como era antes".
  const comData = investimentos.filter((i) => i.purchaseDate || i.date);
  if (comData.length > 0) {
    p("## A historia das posicoes");
    p();
    p("O extrato para na janela acima. As posicoes, nao: cada uma diz quando foi");
    p("comprada. E a unica janela longa que esta coleta tem.");
    p();
    p("| Comprada em | Papel | Aportado | Hoje | Situacao |");
    p("|---|---|---:|---:|---|");

    const ordem = [...comData].sort((a, b) =>
      String(a.purchaseDate ?? a.date).localeCompare(String(b.purchaseDate ?? b.date)),
    );
    for (const i of ordem) {
      const encerrada = String(i.status ?? "").startsWith("TOTAL_WITH") || !(i.amount ?? 0);
      const venda = (movimentos ?? []).find(
        (m) => m.investimento === i.name && m.type === "SELL",
      );
      p(
        `| ${dia(i.purchaseDate) || "—"} | ${(i.name ?? "").slice(0, 46)} ` +
          `| ${i.amountOriginal ? dinheiro(i.amountOriginal) : "—"} ` +
          `| ${encerrada ? "—" : dinheiro(i.amount)} ` +
          `| ${encerrada ? `encerrada em ${dia(i.date)}${venda ? ` por ${dinheiro(venda.amount)}` : ""}` : "ativa"} |`,
      );
    }
    p();
  }

  /* --- o resgate que nao chegou ------------------------------------------ */

  // A pergunta que ninguem faz sozinho olhando o extrato: a posicao foi
  // encerrada — o dinheiro dela apareceu na conta? Quando aparece, bate ao
  // centavo no mesmo dia. Quando nao aparece, e a unica coisa nesta coleta que
  // merece a palavra "sumiu", e ainda assim so como pergunta.
  const entradas = todos.filter((t) => t.amount > 0);
  const encerradas = investimentos.filter(
    (i) => String(i.status ?? "").startsWith("TOTAL_WITH") || !(i.amount ?? 0),
  );

  const semRastro = [];
  for (const i of encerradas) {
    const venda = (movimentos ?? []).find(
      (m) => m.investimento === i.name && m.type === "SELL",
    );
    if (!venda) {
      semRastro.push({ papel: i.name, em: dia(i.date), valor: null });
      continue;
    }
    const caiu = entradas.some((t) => Math.abs(t.amount - venda.amount) < 0.02);
    if (!caiu) semRastro.push({ papel: i.name, em: dia(venda.date), valor: venda.amount });
  }

  if (encerradas.length > 0) {
    p("## Posicoes encerradas: o dinheiro apareceu na conta?");
    p();
    const conferidas = encerradas.length - semRastro.length;
    p(
      `${encerradas.length} posicao(oes) foram encerradas. ${conferidas} tiveram o ` +
        "resgate batendo ao centavo com uma entrada na conta corrente, no mesmo dia.",
    );
    p();

    if (semRastro.length > 0) {
      p(`### ${semRastro.length} sem rastro na conta corrente`);
      p();
      p("| Papel | Encerrada em | Valor do resgate |");
      p("|---|---|---:|");
      for (const x of semRastro) {
        p(`| ${x.papel} | ${x.em} | ${x.valor ? dinheiro(x.valor) : "**nao informado**"} |`);
      }
      p();
      p("Isto **nao prova desvio**. Uma posicao pode ter sido encerrada antes da");
      p("janela e so agora sair da lista, ou o resgate pode ter sido liquidado em");
      p("outra conta, ou a instituicao pode simplesmente nao reportar o movimento.");
      p("Mas e a unica linha desta coleta que o extrato nao explica sozinho — e e");
      p("exatamente ela que se leva ao banco, com nome e data, para pedir o");
      p("documento: quanto foi resgatado, quando, e para qual conta foi creditado.");
      p();
    }
  }

  /* --- mes a mes ---------------------------------------------------------- */

  const meses = new Map();
  for (const t of todos) {
    const mes = dia(t.date).slice(0, 7);
    if (!mes) continue;
    const atual = meses.get(mes) ?? { entrou: 0, saiu: 0 };
    if (t.amount > 0) atual.entrou += t.amount;
    else atual.saiu += t.amount;
    meses.set(mes, atual);
  }

  if (meses.size > 0) {
    // Saldo ao fim de cada mes, andando de tras para frente a partir do saldo de
    // hoje. E a coluna que responde "quando o dinheiro foi embora" — o resultado
    // do mes sozinho nao responde, porque um mes ruim no meio de doze some.
    const hoje = contas.reduce((soma, c) => soma + (c.balance ?? 0), 0);
    const aoFimDoMes = new Map();
    let corrido = hoje;
    for (const t of [...ordenados].reverse()) {
      const mes = dia(t.date).slice(0, 7);
      if (mes && !aoFimDoMes.has(mes)) aoFimDoMes.set(mes, corrido);
      corrido -= t.amount ?? 0;
    }

    p("## Mes a mes");
    p();
    p("| Mes | Entrou | Saiu | Resultado | Saldo ao fim |");
    p("|---|---:|---:|---:|---:|");
    for (const [mes, v] of [...meses].sort()) {
      p(
        `| ${mes} | ${dinheiro(v.entrou)} | ${dinheiro(v.saiu)} | ` +
          `${dinheiro(v.entrou + v.saiu)} | ${dinheiro(aoFimDoMes.get(mes) ?? 0)} |`,
      );
    }
    p();
    p("O saldo ao fim tambem e deduzido do saldo de hoje, e soma todas as contas.");
    p();
  }

  /* --- para onde foi ------------------------------------------------------ */

  const saidas = todos.filter((t) => t.amount < 0);
  const deBolso = saidas.filter(mudouDeBolso);
  const paraFora = saidas.filter((t) => !mudouDeBolso(t));

  p("## Para onde foi o dinheiro que saiu");
  p();
  const soma = (lista) => Math.abs(lista.reduce((s, t) => s + t.amount, 0));
  const proprias = deBolso.filter((t) => contraparte(t).propria);
  const aplicacoes = deBolso.filter((t) => !contraparte(t).propria);

  p(`Sairam ${dinheiro(soma(saidas))} da conta na janela, em tres destinos:`);
  p();
  p("| Para onde | Valor | O que significa |");
  p("|---|---:|---|");
  p(
    `| Aplicacao nos proprios investimentos | ${dinheiro(soma(aplicacoes))} ` +
      "| continua sendo dela, na aba Investimentos |",
  );
  p(
    `| Conta dela em outro banco | ${dinheiro(soma(proprias))} ` +
      "| mesmo CPF dos dois lados: nao saiu do controle dela |",
  );
  p(`| **Terceiros** | **${dinheiro(soma(paraFora))}** | **e so isto que e pergunta** |`);
  p();
  p("A primeira linha sai de PALAVRA na descricao e e heuristica — confira no CSV.");
  p("A segunda nao e: ela compara o documento de quem paga com o de quem recebe, e");
  p("documento igual e a mesma pessoa. Que o documento do recebedor e real, e nao");
  p("copia do pagador, se ve nas linhas em que ele difere.");
  p();

  if (proprias.length > 0) {
    const destinos = new Map();
    for (const t of proprias) {
      const c = contraparte(t);
      const atual = destinos.get(c.banco) ?? { n: 0, total: 0, nome: c.nome };
      atual.n += 1;
      atual.total += Math.abs(t.amount);
      destinos.set(c.banco, atual);
    }
    p("### Para a conta dela em outro banco");
    p();
    p("| Destino | Em nome de | Vezes | Total |");
    p("|---|---|---:|---:|");
    for (const [banco, v] of destinos) {
      p(`| ${banco || "(sem dados da conta)"} | ${v.nome} | ${v.n} | ${dinheiro(v.total)} |`);
    }
    p();
    p("Este dinheiro nao sumiu — ele esta no outro banco. Para fechar a conta de");
    p("verdade, o extrato que falta e o de la.");
    p();
  }

  const porContraparte = new Map();
  for (const t of paraFora) {
    const { nome, doc } = contraparte(t);
    const chave = `${nome}|${doc}`;
    const atual = porContraparte.get(chave) ?? { nome, doc, n: 0, total: 0, primeiro: "", ultimo: "" };
    atual.n += 1;
    atual.total += t.amount;
    const d = dia(t.date);
    if (!atual.primeiro || d < atual.primeiro) atual.primeiro = d;
    if (d > atual.ultimo) atual.ultimo = d;
    porContraparte.set(chave, atual);
  }

  if (porContraparte.size > 0) {
    p("### Por quem recebeu");
    p();
    p("| Quem | Documento | Vezes | Total | De | Ate |");
    p("|---|---|---:|---:|---|---|");
    for (const v of [...porContraparte.values()].sort((a, b) => a.total - b.total).slice(0, 40)) {
      p(`| ${v.nome} | ${v.doc} | ${v.n} | ${dinheiro(v.total)} | ${v.primeiro} | ${v.ultimo} |`);
    }
    p();
    p("So terceiros aqui: transferencia para conta da propria pessoa saiu desta");
    p("tabela. O mesmo nome recebendo muitas vezes e o padrao que vale olhar.");
    p();
  }

  p("### As 30 maiores saidas");
  p();
  p("| Data | Valor | Descricao | Quem recebeu | |");
  p("|---|---:|---|---|---|");
  for (const t of [...saidas].sort((a, b) => a.amount - b.amount).slice(0, 30)) {
    const { nome, doc } = contraparte(t);
    p(
      `| ${dia(t.date)} | ${dinheiro(t.amount)} | ${t.description ?? ""} ` +
        `| ${nome} ${doc} | ${contraparte(t).propria ? "conta dela em outro banco" : mudouDeBolso(t) ? "aplicacao" : ""} |`,
    );
  }
  p();

  p("---");
  p();
  p("Os numeros acima saem dos CSVs desta mesma pasta, que sao a fonte. Se algum");
  p("deles for virar conversa com o banco ou com a policia, leve o CSV, nao o resumo:");
  p("aqui os documentos estao mascarados para o arquivo poder ser mostrado a alguem,");
  p("e no CSV estao inteiros, que e o que serve de prova.");

  return linhas.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Execucao                                                                   */
/* -------------------------------------------------------------------------- */

await lerEnv();

// A raiz do projeto sai do lugar do PROPRIO script, e nao de `process.cwd()`:
// rodar de outra pasta nao pode afrouxar a protecao nem inventar uma falsa.
const projeto = path.resolve(import.meta.dirname, "..");
const saida = path.resolve(
  opcao("saida") ?? path.join(homedir(), "extrato-pluggy", `${itemId}-${new Date().toISOString().slice(0, 10)}`),
);

// Dado de terceiro nao mora num repositorio que sobe sozinho a cada push.
if (saida === projeto || saida.startsWith(projeto + path.sep)) {
  console.error(
    `Recusei gravar em ${saida}: e dentro de ${projeto}.\n` +
      "Escolha uma pasta fora dele, ou deixe o padrao (~/extrato-pluggy).",
  );
  process.exit(1);
}

await autenticar();

console.log(`Lendo a conexao ${itemId}...\n`);

const item = await pegar(`/items/${itemId}`);
console.log(`  ${item?.connector?.name ?? "?"} · status ${item?.status ?? "?"}`);

const contas = (await pegar(`/accounts?itemId=${itemId}`))?.results ?? [];
console.log(`  ${contas.length} conta(s)`);

if (argumentos.includes("--sondar")) {
  const investimentosParaSondar = (await pegar(`/investments?itemId=${itemId}`))?.results ?? [];
  const umInvestimento = investimentosParaSondar[0]?.id;
  const umaConta = contas[0]?.id;

  const candidatos = [
    `/brokerage-notes?itemId=${itemId}`,
    `/brokerage_notes?itemId=${itemId}`,
    `/brokerageNotes?itemId=${itemId}`,
    `/investments/brokerage-notes?itemId=${itemId}`,
    `/items/${itemId}/brokerage-notes`,
    umaConta ? `/brokerage-notes?accountId=${umaConta}` : null,
    umInvestimento ? `/investments/${umInvestimento}/brokerage-notes` : null,
    umInvestimento ? `/investments/${umInvestimento}/brokerage_notes` : null,
    `/benefits?itemId=${itemId}`,
    `/opportunities?itemId=${itemId}`,
    `/portfolios?itemId=${itemId}`,
    `/items/${itemId}/resources`,
    `/items/${itemId}/products`,
    `/consents?itemId=${itemId}`,
    umaConta ? `/bills?accountId=${umaConta}` : null,
  ].filter(Boolean);

  console.log("\n--sondar: batendo em cada rota candidata\n");
  const mapa = [];
  for (const caminho of candidatos) {
    const r = await sondar(caminho);
    mapa.push(r);
    const marca = r.status === 200 ? "OK " : r.status === 404 ? "404" : `${r.status}`;
    console.log(
      `  ${marca}  ${caminho}` +
        (r.quantos !== null ? `   -> ${r.quantos} item(ns)` : "") +
        (r.status === 200 && r.quantos === null ? `   -> ${r.amostra}` : ""),
    );
  }

  const abriram = mapa.filter((r) => r.status === 200);
  console.log(
    `\n${abriram.length} rota(s) responderam 200. ` +
      "As que trouxeram item sao as que faltavam — me mande esta saida.",
  );
  process.exit(0);
}

const lancamentosPorConta = new Map();
for (const conta of contas) {
  console.log(`\n  ${conta.name ?? conta.type} ${conta.number ?? ""} — ${dinheiro(conta.balance)}`);
  const lancamentos = await todosOsLancamentos(conta.id);
  lancamentosPorConta.set(conta.id, lancamentos);
  console.log(`    ${lancamentos.length} lancamento(s)`);
}

const investimentos = (await pegar(`/investments?itemId=${itemId}`))?.results ?? [];
console.log(`\n  ${investimentos.length} investimento(s)`);

// Movimento de cada investimento, quando a instituicao expoe. Muitas nao expoem,
// e um 404 aqui e ausencia de dado e nao falha da coleta.
const movimentos = [];
for (const investimento of investimentos) {
  const corpo = await pegar(`/investments/${investimento.id}/transactions`, [404, 400]);
  for (const m of corpo?.results ?? []) movimentos.push({ ...m, investimento: investimento.name });
}
if (movimentos.length > 0) console.log(`  ${movimentos.length} movimento(s) de investimento`);

/*
 * O resto do que a conexao carrega.
 *
 * O `item.products` diz o que foi coletado. Pedir menos do que esta ali e
 * deixar dado em cima da mesa sem saber — e num caso em que a pergunta e "para
 * onde foi o dinheiro", emprestimo tomado no nome da pessoa e nota de
 * corretagem de um resgate sao exatamente o que falta.
 */
const extras = [];
for (const [nome, caminhos] of [
  ["identidade", [`/identity?itemId=${itemId}`]],
  ["emprestimos", [`/loans?itemId=${itemId}`]],
  [
    "notas de corretagem",
    [
      `/brokerage-notes?itemId=${itemId}`,
      `/brokerage_notes?itemId=${itemId}`,
      `/investments/brokerage-notes?itemId=${itemId}`,
    ],
  ],
  ["beneficios", [`/benefits?itemId=${itemId}`]],
  // Estas duas responderam 200 onde a familia de produtos responde 403: o
  // consentimento diz o que foi autorizado e ate quando, e `resources` lista o
  // que a conexao coletou de fato. Sao a prova documental de ate onde a coleta
  // podia ir — e e o que sobra quando um produto e barrado pelo plano.
  ["consentimento", [`/consents?itemId=${itemId}`]],
  ["recursos coletados", [`/items/${itemId}/resources`]],
]) {
  extras.push(await primeiroQueResponder(nome, caminhos));
}

// Fatura de cartao e por conta, e nao por conexao.
for (const conta of contas) {
  if (String(conta.type ?? "").toUpperCase() !== "CREDIT") continue;
  const achado = await primeiroQueResponder(
    `faturas do cartao ${conta.number ?? conta.id}`,
    [`/bills?accountId=${conta.id}`],
  );
  extras.push(achado);

  // A fatura traz o total; os lancamentos dela vem por fatura.
  for (const fatura of achado.itens) {
    if (!fatura?.id) continue;
    const linhas = await primeiroQueResponder(
      `lancamentos da fatura ${dia(fatura.dueDate)}`,
      [`/bills/${fatura.id}/transactions`, `/v2/transactions?billId=${fatura.id}`],
    );
    if (linhas.itens.length > 0) extras.push(linhas);
  }
}

for (const e of extras) {
  console.log(
    `  ${e.nome}: ${e.caminho ? `${e.itens.length} item(ns)` : "nao respondeu em nenhuma rota"}`,
  );
}

/* --- gravar -------------------------------------------------------------- */

await mkdir(saida, { recursive: true });

await writeFile(
  path.join(saida, "bruto.json"),
  JSON.stringify(
    { item, contas, lancamentos: Object.fromEntries(lancamentosPorConta), investimentos, movimentos, extras },
    null,
    2,
  ),
);

for (const conta of contas) {
  const lancamentos = [...(lancamentosPorConta.get(conta.id) ?? [])].sort((a, b) =>
    dia(a.date).localeCompare(dia(b.date)),
  );

  // Saldo corrido de tras para frente: o extrato do banco mostra essa coluna e
  // e por ela que se acha o dia em que o dinheiro foi embora.
  let corrido = conta.balance ?? 0;
  const acumulado = new Map();
  for (const t of [...lancamentos].reverse()) {
    acumulado.set(t.id, corrido);
    corrido -= t.amount ?? 0;
  }

  const nome = `conta-${(conta.number ?? conta.id).toString().replace(/\W/g, "")}.csv`;
  await writeFile(
    path.join(saida, nome),
    csv([
      ["data", "descricao", "valor", "saldo apos", "categoria", "tipo", "quem", "documento", "mudou de bolso (para onde)", "id"],
      ...lancamentos.map((t) => {
        const { nome, docInteiro, propria } = contraparte(t);
        return [
          dia(t.date),
          t.description ?? "",
          (t.amount ?? 0).toFixed(2).replace(".", ","),
          (acumulado.get(t.id) ?? 0).toFixed(2).replace(".", ","),
          t.category ?? "",
          t.type ?? "",
          nome,
          docInteiro,
          propria ? "conta dela em outro banco" : mudouDeBolso(t) ? "aplicacao" : "",
          t.id,
        ];
      }),
    ]),
  );
  console.log(`\n  ${nome}`);
}

if (investimentos.length > 0) {
  await writeFile(
    path.join(saida, "investimentos.csv"),
    csv([
      ["nome", "tipo", "subtipo", "emissor", "aportado", "bruto", "liquido", "quantidade", "vencimento"],
      ...investimentos.map((i) => [
        i.name ?? "",
        i.type ?? "",
        i.subtype ?? "",
        i.issuer ?? "",
        (i.amountOriginal ?? 0).toFixed(2).replace(".", ","),
        (i.amount ?? 0).toFixed(2).replace(".", ","),
        (i.balance ?? 0).toFixed(2).replace(".", ","),
        i.quantity ?? "",
        dia(i.dueDate),
      ]),
    ]),
  );
  console.log("  investimentos.csv");
}

if (movimentos.length > 0) {
  await writeFile(
    path.join(saida, "movimentos-investimento.csv"),
    csv([
      ["data", "papel", "tipo", "valor", "quantidade", "descricao"],
      ...movimentos.map((m) => [
        dia(m.date),
        m.investimento ?? "",
        m.type ?? m.movementType ?? "",
        (m.amount ?? 0).toFixed(2).replace(".", ","),
        m.quantity ?? "",
        m.description ?? "",
      ]),
    ]),
  );
  console.log("  movimentos-investimento.csv");
}

await writeFile(
  path.join(saida, "resumo.md"),
  montarResumo({ item, contas, lancamentosPorConta, investimentos, movimentos, extras }),
);

console.log("  resumo.md");
console.log(`\nTudo em ${saida}`);
console.log("Nada foi gravado no banco do projeto.");
