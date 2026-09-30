#!/usr/bin/env node
/**
 * "E se esse dinheiro tivesse ido para o fundo, na mesma data?"
 *
 * Compara cada LOTE de um papel da carteira com o mesmo aporte, no mesmo dia,
 * num fundo qualquer identificado pelo CNPJ. Lote a lote, porque a resposta
 * media mente: um aporte de 2023 e outro de 2026 viveram mercados diferentes, e
 * so a comparacao por data diz qual dos dois carregou o resultado.
 *
 * O valor da cota vem do informe diario da CVM, que e publico e sai um arquivo
 * por mes. So os meses com aporte sao baixados, e o que foi lido fica em cache
 * fora do projeto — o arquivo de um mes tem dezenas de megabytes e nao ha razao
 * para baixar duas vezes.
 *
 * O lado da carteira e marcado pelo preco OFICIAL do Tesouro quando ele existe
 * em `treasury_quotes`, e nao pelo que a corretora diz. Ja foi medido neste
 * projeto: quatro custodias marcavam o mesmo titulo a precos diferentes, e a
 * diferenca era de R$ 54 mil. Comparar contra um numero defasado seria vencer
 * ou perder a comparacao por causa do erro, e nao do mercado.
 *
 * Imposto entra nos dois lados porque eles nao pagam igual: renda fixa segue a
 * tabela regressiva, fundo de acoes paga 15% sobre o ganho e nao tem
 * come-cotas. Comparar so o bruto favorece o papel que ainda deve imposto.
 *
 * Uso:
 *   node scripts/comparar.mjs --papel "Renda+" --cnpj 18.248.733/0001-05
 *   node scripts/comparar.mjs --papel "Renda+" --cnpj ... --arquivo informe.csv
 *   node scripts/comparar.mjs --papel "Renda+" --cnpj ... --ate 2026-09-24
 */

import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
import { casarComOTitulo } from "../src/lib/tesouro.mjs";
import {
  aoAno,
  impostoDeFia,
  lerInformeDeFluxo,
  lerSerieSolta,
  lerSeriesJson,
  mesesNecessarios,
  simularAporte,
  soDigitos,
} from "../src/lib/cvm.mjs";

const CVM = "https://dados.cvm.gov.br/dados/FI/DOC/INF_DIARIO/DADOS";

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

const dinheiro = (v) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const pct = (v) =>
  v === null || v === undefined
    ? "—"
    : `${v >= 0 ? "+" : ""}${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const dia = (v) =>
  !v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

const diasEntre = (de, ate) =>
  Math.round((Date.parse(`${ate}T00:00:00Z`) - Date.parse(`${de}T00:00:00Z`)) / 86400000);

/* -------------------------------------------------------------------------- */
/* A serie de cotas                                                           */
/* -------------------------------------------------------------------------- */

const lerInforme = (fluxo, cnpj) =>
  lerInformeDeFluxo(fluxo, cnpj, (f) => createInterface({ input: f, crlfDelay: Infinity }));

/**
 * Um mes do informe, baixado e descompactado.
 *
 * O zip vai para um arquivo temporario porque `unzip` nao le de stdin. Sai por
 * `unzip -p`, que joga o conteudo no stdout sem criar arquivo — assim o CSV de
 * centenas de megabytes nunca toca o disco.
 */
async function baixarMes(mes, cnpj) {
  const url = `${CVM}/inf_diario_fi_${mes}.zip`;
  console.log(`  baixando ${url}`);

  const resposta = await fetch(url);
  if (!resposta.ok) {
    throw new Error(
      `${url} respondeu HTTP ${resposta.status}. ` +
        "Se a CVM mudou o endereco, baixe o arquivo e use --arquivo.",
    );
  }

  const zip = path.join(tmpdir(), `inf_${mes}_${process.pid}.zip`);
  await writeFile(zip, Buffer.from(await resposta.arrayBuffer()));

  try {
    const descompactando = spawn("unzip", ["-p", zip]);
    let erro = "";
    descompactando.stderr.on("data", (d) => (erro += d));
    descompactando.on("error", () => {
      erro += "o comando `unzip` nao esta disponivel";
    });

    const pontos = await lerInforme(descompactando.stdout, cnpj);
    if (pontos.length === 0 && erro) throw new Error(erro.trim());
    return pontos;
  } finally {
    await unlink(zip).catch(() => {});
  }
}

/** O cache fica fora do projeto: e dado publico, mas nao e codigo. */
function ondeGuardar(cnpj) {
  return path.join(homedir(), ".cache", "controle-financeiro", `cotas-${cnpj}.json`);
}

async function lerCache(cnpj) {
  try {
    return JSON.parse(await readFile(ondeGuardar(cnpj), "utf8"));
  } catch {
    return { meses: {}, cnpj };
  }
}

async function gravarCache(cnpj, cache) {
  const destino = ondeGuardar(cnpj);
  await mkdir(path.dirname(destino), { recursive: true });
  await writeFile(destino, JSON.stringify(cache));
}

/* -------------------------------------------------------------------------- */
/* Execucao                                                                   */
/* -------------------------------------------------------------------------- */

await lerEnv();

const alvo = opcao("papel");
const cnpj = soDigitos(opcao("cnpj"));

const serieSolta = opcao("cotas");

if (!alvo || (!serieSolta && cnpj.length !== 14)) {
  console.error(
    "Faltou o papel, e o CNPJ do fundo ou um arquivo de cotas.\n\n" +
      '  node scripts/comparar.mjs --papel "Renda+" --cnpj 18.248.733/0001-05\n' +
      '  node scripts/comparar.mjs --papel "Renda+" --cotas cotas.csv\n',
  );
  process.exit(1);
}

const chave = lerChaveDoAmbiente();
const banco = await abrirBanco().catch(morrerComExplicacao);

const abrir = (v) => {
  if (!v) return null;
  try {
    return decifrarCom(chave, v);
  } catch {
    return null;
  }
};

try {
  /* --- os lotes da carteira --------------------------------------------- */

  // Sem filtro no SQL: o que nao serve precisa ser CONTADO e explicado. A
  // primeira versao filtrava aqui, uma boleta sobrava, e a tela dizia so o
  // resultado dela — como se fosse a carteira inteira.
  const linhas = await banco.query(
    `SELECT id, institution, name_enc, amount, gross_amount, balance, taxes,
            quantity, unit_price, due_date, purchase_date
       FROM investments
      ORDER BY purchase_date NULLS LAST`,
  );

  const todos = linhas
    .map((l) => ({
      id: l.id,
      institution: l.institution,
      nome: abrir(l.name_enc) ?? "(sem nome)",
      aportado: Number(l.amount),
      bruto: Number(l.gross_amount ?? l.balance ?? 0),
      imposto: l.taxes === null ? null : Number(l.taxes),
      quantidade: l.quantity === null ? null : Number(l.quantity),
      precoUnitario: l.unit_price === null ? null : Number(l.unit_price),
      vence: dia(l.due_date),
      compradoEm: dia(l.purchase_date),
    }))
    .filter((l) => l.nome.toLowerCase().includes(alvo.toLowerCase()));

  if (todos.length === 0) {
    const nomes = [...new Set(linhas.map((l) => abrir(l.name_enc)).filter(Boolean))];
    console.error(
      `Nenhuma posicao com "${alvo}" no nome. O que existe na carteira:\n` +
        nomes.map((n) => `  ${n}`).join("\n"),
    );
    process.exit(1);
  }

  const semData = todos.filter((l) => !l.compradoEm);
  const semAporte = todos.filter((l) => l.compradoEm && !(l.aportado > 0));
  const lotes = todos.filter((l) => l.compradoEm && l.aportado > 0);

  console.log(
    `\n${todos.length} posicao(oes) casam com "${alvo}"; ${lotes.length} tem data de` +
      " compra e valor aportado.",
  );

  if (semData.length > 0) {
    const soma = semData.reduce((s, l) => s + l.bruto, 0);
    console.log(
      `  ${semData.length} sem data de compra (${dinheiro(soma)}): ficam de fora, porque` +
        "\n  sem a data nao ha em que dia comprar a cota do fundo. A data veio na" +
        "\n  migracao 026 — se a coluna esta vazia, rode `npm run sync`.",
    );
  }
  if (semAporte.length > 0) {
    const soma = semAporte.reduce((s, l) => s + l.bruto, 0);
    console.log(
      `  ${semAporte.length} sem valor aportado (${dinheiro(soma)}): a Pluggy nao mandou` +
        "\n  `amountOriginal` nessas, e sem ele nao ha quanto aplicar no fundo.",
    );
  }

  if (lotes.length === 0) {
    console.error("\nNenhuma boleta utilizavel. Veja os motivos acima.");
    process.exit(1);
  }

  /* --- marcar pelo preco oficial, quando ele existe ---------------------- */

  const precos = (
    await banco.query(
      `SELECT title, maturity, quoted_at, buy_rate, sell_price FROM treasury_quotes`,
    )
  ).map((p) => ({
    titulo: p.title,
    vence: dia(p.maturity),
    base: dia(p.quoted_at),
    taxaCompra: Number(p.buy_rate),
    precoVenda: Number(p.sell_price),
  }));

  let remarcados = 0;
  for (const lote of lotes) {
    const achado = casarComOTitulo(
      { precoUnitario: lote.precoUnitario, vence: lote.vence },
      precos,
    );
    if (!achado || !(lote.quantidade > 0)) continue;

    const brutoNovo = lote.quantidade * achado.precoVenda;
    // O imposto acompanha o lucro, preservando a aliquota do lote: a faixa da
    // tabela regressiva depende do prazo, e remarcar o preco nao muda prazo.
    if (lote.imposto !== null && lote.bruto > lote.aportado) {
      const aliquota = lote.imposto / (lote.bruto - lote.aportado);
      lote.imposto = Math.max(0, (brutoNovo - lote.aportado) * aliquota);
    }
    lote.bruto = brutoNovo;
    lote.marcadoEm = achado.base;
    remarcados += 1;
  }

  /* --- a serie de cotas do fundo ----------------------------------------- */

  const exportar = opcao("exportar");
  if (exportar) {
    await writeFile(
      path.resolve(exportar),
      JSON.stringify(
        lotes.map((l) => ({
          id: l.id,
          nome: l.nome,
          instituicao: l.institution,
          compradoEm: l.compradoEm,
          vence: l.vence,
          aportado: l.aportado,
          bruto: l.bruto,
          imposto: l.imposto,
          quantidade: l.quantidade,
          precoUnitario: l.precoUnitario,
          marcadoEm: l.marcadoEm ?? null,
        })),
        null,
        2,
      ),
    );
    console.log(`\n${lotes.length} boleta(s) em ${exportar}, com nome, id e vencimento.`);
  }

  if (serieSolta) {
    console.log(`\nLendo as cotas de ${serieSolta}`);
  }

  /*
   * Duas formas de serie pronta. O JSON com um dia por chave e varias series
   * dentro traz os indices junto — e ai a pergunta deixa de ser "o fundo bateu
   * o meu papel" e vira "quem bateu quem", que e a que vale.
   */
  let referencias = new Map();

  if (serieSolta) {
    const conteudo = await readFile(path.resolve(serieSolta), "utf8");
    if (conteudo.trimStart().startsWith("{")) {
      referencias = lerSeriesJson(conteudo);
    } else {
      referencias.set("fundo", lerSerieSolta(conteudo));
    }
  }

  const cache = serieSolta
    ? { cnpj, meses: { colada: referencias.get(opcao("serie") ?? "fundo") ?? [] } }
    : await lerCache(cnpj);
  const local = serieSolta ? null : opcao("arquivo");

  if (local) {
    console.log(`\nLendo ${local}`);
    const pontos = await lerInforme(createReadStream(path.resolve(local), "utf8"), cnpj);
    for (const p of pontos) (cache.meses[p.dia.slice(0, 7).replace("-", "")] ??= []).push(p);
  } else if (!serieSolta) {
    const hoje = new Date().toISOString().slice(0, 10);
    const precisa = mesesNecessarios([...lotes.map((l) => l.compradoEm), hoje]);
    const faltando = precisa.filter((m) => !cache.meses[m]);

    console.log(
      `\n${precisa.length} mes(es) de informe necessarios; ` +
        `${precisa.length - faltando.length} ja em cache.`,
    );

    for (const mes of faltando) {
      cache.meses[mes] = await baixarMes(mes, cnpj);
    }
    if (faltando.length > 0) await gravarCache(cnpj, cache);
  }

  const serie = Object.values(cache.meses).flat().sort((a, b) => a.dia.localeCompare(b.dia));

  if (serie.length === 0) {
    console.error(
      `\nNenhuma cotacao do CNPJ ${cnpj} nos arquivos lidos.\n` +
        "Confira o CNPJ: o informe traz o do fundo, e para fundo de cotas o que\n" +
        "aparece pode ser o da classe.",
    );
    process.exit(1);
  }

  const ate = opcao("ate") ?? serie.at(-1).dia;

  console.log(
    `\nCotas de ${serie[0].dia} a ${serie.at(-1).dia} (${serie.length} pregoes).` +
      ` Comparando ate ${ate}.`,
  );
  if (remarcados > 0) {
    console.log(`${remarcados} lote(s) remarcado(s) pelo preco oficial do Tesouro.\n`);
  } else {
    console.log("Nenhum preco oficial casou: os valores sao os da corretora.\n");
  }

  /* --- a conta, lote a lote ---------------------------------------------- */

  const larg = [12, 14, 15, 10, 15, 10, 14];
  const cab = ["compra", "aportado", alvo, "a.a.", "fundo", "a.a.", "diferenca"];
  console.log(cab.map((c, i) => c.padStart(larg[i])).join(""));
  console.log("-".repeat(larg.reduce((a, b) => a + b, 0)));

  const soma = { aportado: 0, papel: 0, fundo: 0, papelLiq: 0, fundoLiq: 0 };
  let semCota = 0;
  let semImposto = 0;



  for (const lote of lotes) {
    const s = simularAporte(
      { aportado: lote.aportado, compradoEm: lote.compradoEm },
      serie,
      ate,
    );
    if (!s) {
      semCota += 1;
      continue;
    }

    // Imposto ausente nao e imposto zero. Somar como zero faria o lado do papel
    // parecer melhor do que e, justamente na coluna que existe para comparar.
    if (lote.imposto === null) semImposto += 1;
    const papelLiq = lote.bruto - (lote.imposto ?? 0);
    const fundoLiq = s.valor - impostoDeFia(lote.aportado, s.valor);

    // Cada lado anualiza sobre a PROPRIA janela: o papel foi marcado no dia do
    // preco oficial, o fundo na ultima cota publicada, e as duas datas podem
    // diferir por alguns dias. Usar a contagem do fundo para os dois punha um
    // prazo emprestado no denominador.
    const diasDoPapel = diasEntre(lote.compradoEm, lote.marcadoEm ?? ate);

    soma.aportado += lote.aportado;
    soma.papel += lote.bruto;
    soma.fundo += s.valor;
    soma.papelLiq += papelLiq;
    soma.fundoLiq += fundoLiq;

    const linha = [
      lote.compradoEm,
      dinheiro(lote.aportado),
      dinheiro(lote.bruto),
      pct(aoAno(lote.aportado, lote.bruto, diasDoPapel)),
      dinheiro(s.valor),
      pct(aoAno(lote.aportado, s.valor, s.dias)),
      dinheiro(s.valor - lote.bruto),
    ];
    console.log(linha.map((c, i) => String(c).padStart(larg[i])).join(""));

    if (s.entrada.atraso > 4) {
      console.log(
        `${" ".repeat(larg[0])}  ^ cota de ${s.entrada.dia}, ${s.entrada.atraso} dias antes da compra`,
      );
    }
  }

  console.log("-".repeat(larg.reduce((a, b) => a + b, 0)));
  console.log(
    ["total", dinheiro(soma.aportado), dinheiro(soma.papel), "", dinheiro(soma.fundo), "",
      dinheiro(soma.fundo - soma.papel)].map((c, i) => String(c).padStart(larg[i])).join(""),
  );

  if (semCota > 0) {
    console.log(
      `\n${semCota} lote(s) ficaram de fora: comprados antes da primeira cota do fundo.`,
    );
  }

  if (semImposto > 0) {
    console.log(
      `\n${semImposto} lote(s) sem imposto informado entraram no liquido como se nao` +
        " devessem nada.\nO numero do papel abaixo esta otimista nessa medida.",
    );
  }

  /* --- e a mesma conta depois do imposto --------------------------------- */

  console.log("\nDepois do imposto — a tabela regressiva de um lado, 15% do fundo de acoes do outro:");
  console.log(`  ${alvo}: ${dinheiro(soma.papelLiq)}`);
  console.log(`  fundo : ${dinheiro(soma.fundoLiq)}`);
  const d = soma.fundoLiq - soma.papelLiq;
  console.log(
    `  ${d >= 0 ? "o fundo teria rendido" : "o papel rendeu"} ${dinheiro(Math.abs(d))} ` +
      `${d >= 0 ? "a mais" : "a mais"}.`,
  );

  /* --- e contra cada referencia que veio junto ---------------------------- */

  if (referencias.size > 1) {
    console.log("\nMesmos aportes, mesmas datas, contra cada referencia do arquivo:\n");
    const larg = [22, 18, 12, 16];
    console.log(
      ["referencia", "valor hoje", "a.a.", "vs o papel"]
        .map((c, i) => c.padStart(larg[i]))
        .join(""),
    );
    console.log("-".repeat(larg.reduce((a, b) => a + b, 0)));

    const linhas = [{ nome: alvo, valor: soma.papel, aa: null }];

    for (const [nome, serie] of referencias) {
      let total = 0;
      let fora = 0;
      let diasPonderados = 0;

      for (const lote of lotes) {
        const r = simularAporte(
          { aportado: lote.aportado, compradoEm: lote.compradoEm },
          serie,
          opcao("ate") ?? serie.at(-1).dia,
        );
        if (!r) {
          fora += 1;
          continue;
        }
        total += r.valor;
        diasPonderados += r.dias * lote.aportado;
      }

      // Prazo medio ponderado pelo aporte: anualizar a carteira inteira por um
      // unico prazo so faz sentido se o prazo for o que o dinheiro viveu, e nao
      // a media simples das boletas.
      const dias = soma.aportado > 0 ? diasPonderados / soma.aportado : 0;
      linhas.push({
        nome,
        valor: total,
        aa: aoAno(soma.aportado, total, dias),
        fora,
      });
    }

    const diasDoPapel =
      soma.aportado > 0
        ? lotes.reduce((s, l) => s + diasEntre(l.compradoEm, l.marcadoEm ?? ate) * l.aportado, 0) /
          soma.aportado
        : 0;
    linhas[0].aa = aoAno(soma.aportado, soma.papel, diasDoPapel);

    for (const l of [...linhas].sort((a, b) => b.valor - a.valor)) {
      const diferenca = l.nome === alvo ? "" : dinheiro(l.valor - soma.papel);
      console.log(
        [l.nome.slice(0, 20), dinheiro(l.valor), pct(l.aa), diferenca]
          .map((c, i) => String(c).padStart(larg[i]))
          .join("") + (l.fora ? `   (${l.fora} lote(s) fora da serie)` : ""),
      );
    }
    console.log(`\nTodas partem de ${dinheiro(soma.aportado)} aportados nas mesmas datas.`);
  }

  console.log(
    "\nO contrafactual supoe aporte unico na data, sem resgate e sem taxa de\n" +
      "entrada ou saida no fundo. Ele nao desconta o que voce nao poderia ter\n" +
      "feito: carencia, valor minimo e liquidez do fundo nao entram nesta conta.",
  );
} finally {
  await banco.fim?.();
}
