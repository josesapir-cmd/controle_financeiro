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
  const nome = outro?.name?.trim();
  const doc = String(outro?.documentNumber?.value ?? "").trim();
  if (!nome && !doc) return { nome: "(nao identificada)", doc: "", docInteiro: "" };
  return { nome: nome || "(sem nome)", doc: documento(doc), docInteiro: doc };
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
  MUDA_DE_BOLSO.test(`${t.description ?? ""} ${t.descriptionRaw ?? ""} ${t.category ?? ""}`);

const csv = (linhas) =>
  linhas
    .map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";"))
    .join("\n");

/* -------------------------------------------------------------------------- */
/* Relatorio                                                                  */
/* -------------------------------------------------------------------------- */

function montarResumo({ item, contas, lancamentosPorConta, investimentos }) {
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
    if (meses <= 13) {
      p("> **Atencao.** O Open Finance costuma entregar 12 meses e mais nada. Se o");
      p("> dinheiro saiu antes de " + primeiro + ", ele nao esta em lugar nenhum deste");
      p("> arquivo — e nao porque nao existiu. Nesse caso o caminho e pedir o extrato");
      p("> completo direto ao banco, que e um direito do titular, e nao insistir aqui.");
    }
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
  p(
    `Sairam ${dinheiro(soma(saidas))} da conta na janela. Destes, ` +
      `${dinheiro(soma(deBolso))} parecem ter ido para aplicacao ou caixinha ` +
      `— dinheiro que mudou de bolso e continua sendo dela — e ` +
      `**${dinheiro(soma(paraFora))} foram para fora**.`,
  );
  p();
  p("Essa separacao e por PALAVRA na descricao, nao classificacao do banco — trate");
  p("como primeira leitura e confira no CSV antes de acreditar.");
  p();

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
    p("O mesmo nome recebendo muitas vezes e o padrao que vale olhar de perto.");
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
        `| ${nome} ${doc} | ${mudouDeBolso(t) ? "mudou de bolso" : ""} |`,
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

/* --- gravar -------------------------------------------------------------- */

await mkdir(saida, { recursive: true });

await writeFile(
  path.join(saida, "bruto.json"),
  JSON.stringify(
    { item, contas, lancamentos: Object.fromEntries(lancamentosPorConta), investimentos, movimentos },
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
      ["data", "descricao", "valor", "saldo apos", "categoria", "tipo", "quem", "documento", "mudou de bolso", "id"],
      ...lancamentos.map((t) => {
        const { nome, docInteiro } = contraparte(t);
        return [
          dia(t.date),
          t.description ?? "",
          (t.amount ?? 0).toFixed(2).replace(".", ","),
          (acumulado.get(t.id) ?? 0).toFixed(2).replace(".", ","),
          t.category ?? "",
          t.type ?? "",
          nome,
          docInteiro,
          mudouDeBolso(t) ? "sim" : "",
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
  montarResumo({ item, contas, lancamentosPorConta, investimentos }),
);

console.log("  resumo.md");
console.log(`\nTudo em ${saida}`);
console.log("Nada foi gravado no banco do projeto.");
