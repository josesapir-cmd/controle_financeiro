#!/usr/bin/env node
/**
 * "Se eu vender R$ X deste titulo, que boletas saem e quanto pago de imposto?"
 *
 * O banco do app guarda POSICOES — uma linha por titulo e custodia —, e a
 * posicao nao responde isso: o imposto e calculado boleta a boleta, cada uma
 * com a data e o preco da propria compra. As boletas existem na Pluggy, em
 * `/investments/{id}/transactions`, e e de la que este script as busca. Nada
 * e gravado: e uma consulta, e a resposta vale para o preco de hoje.
 *
 * A venda segue PEPS dentro de cada titulo e custodia: as compras mais antigas
 * saem primeiro. Por isso a simulacao e feita por FILA (titulo + custodia), e
 * nao sobre a soma de tudo — R$ 2 milhoes vendidos numa corretora consomem as
 * boletas DAQUELA corretora, e nao as mais antigas da carteira inteira.
 *
 * Preco: o oficial de recompra do Tesouro, de `treasury_quotes` (`npm run
 * tesouro` atualiza). Sem ele, cai no preco que a corretora marcou, e o script
 * diz isso.
 *
 * Uso:
 *   npm run resgate -- --valor 2mm
 *   npm run resgate -- --valor 2mm --liquido         # R$ 2 mi na conta, ja sem IR
 *   npm run resgate -- --valor 2mm --custodia xp     # so a fila dessa corretora
 *   npm run resgate -- --valor 2mm --em 2026-12-01   # e se eu esperar?
 *   npm run resgate -- --papel "Renda+ 2065" --valor 500000
 *   npm run resgate -- --sem-pluggy                  # usa so o que esta no banco
 *   npm run resgate -- --bruto                       # mostra um movimento cru
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
import { casarComOTitulo } from "../src/lib/tesouro.mjs";
import {
  aliquotaDeIr,
  diasEntre,
  economiaEsperando,
  lotesEmAberto,
  planoCombinado,
  simularVenda,
} from "../src/lib/resgate.mjs";

const API = process.env.PLUGGY_API_URL || "https://api.pluggy.ai";

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
const tem = (nome) => argumentos.includes(`--${nome}`);

const dinheiro = (v) =>
  (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const numero = (v, casas = 2) =>
  (v ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (v) => `${numero(v * 100, 1)}%`;
const dia = (v) =>
  !v ? null : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);
const br = (iso) => (iso ? iso.split("-").reverse().join("/") : "—");
const hoje = new Date().toISOString().slice(0, 10);

/**
 * "2mm", "2mi", "2.000.000", "2000000", "1,5mm", "500k".
 *
 * Ponto e separador de milhar e virgula e decimal, como se escreve aqui: ler
 * "2.000.000" como dois e uns quebrados venderia R$ 2.
 */
function lerValor(texto) {
  if (!texto) return null;
  const t = String(texto).trim().toLowerCase().replace(/^r\$\s*/, "");
  const m = t.match(/^([\d.,]+)\s*(mm|mi|milhao|milhoes|m|k|mil)?$/);
  if (!m) return null;
  const n = Number(m[1].replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(n)) return null;
  const mult = { mm: 1e6, mi: 1e6, milhao: 1e6, milhoes: 1e6, m: 1e6, k: 1e3, mil: 1e3 }[m[2]] ?? 1;
  return n * mult;
}

/** Tabela de texto alinhada. A primeira coluna a esquerda, o resto a direita. */
function tabela(cabecalho, linhas) {
  const larg = cabecalho.map((c, i) =>
    Math.max(String(c).length, ...linhas.map((l) => String(l[i] ?? "").length)),
  );
  const fmt = (l) =>
    l
      .map((c, i) => (i === 0 ? String(c ?? "").padEnd(larg[i]) : String(c ?? "").padStart(larg[i])))
      .join("  ");
  console.log("  " + fmt(cabecalho));
  console.log("  " + larg.map((n) => "─".repeat(n)).join("  "));
  for (const l of linhas) console.log("  " + fmt(l));
}

/* -------------------------------------------------------------------------- */
/* Pluggy                                                                     */
/* -------------------------------------------------------------------------- */

let apiKey = null;

async function autenticar() {
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET precisam estar no .env.local.");
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

/** Todas as paginas dos movimentos de um investimento. Nulo se a rota recusar. */
async function movimentosDe(id) {
  const todos = [];
  for (let pagina = 1; pagina <= 50; pagina += 1) {
    const resposta = await fetch(
      `${API}/investments/${id}/transactions?page=${pagina}&pageSize=500`,
      { headers: { "X-API-KEY": apiKey } },
    );
    if (resposta.status === 404 || resposta.status === 400 || resposta.status === 403) {
      return pagina === 1 ? { erro: `HTTP ${resposta.status}` } : { movimentos: todos };
    }
    if (!resposta.ok) {
      throw new Error(
        `/investments/${id}/transactions respondeu HTTP ${resposta.status}: ${await resposta.text()}`,
      );
    }
    const corpo = await resposta.json();
    todos.push(...(corpo.results ?? []));
    const paginas = Number(corpo.totalPages ?? 1);
    if (!(pagina < paginas)) break;
  }
  return { movimentos: todos };
}

/* -------------------------------------------------------------------------- */
/* Execucao                                                                   */
/* -------------------------------------------------------------------------- */

await lerEnv();

const alvoNome = opcao("papel") ?? "Renda+";
const valor = lerValor(opcao("valor"));
const modo = tem("liquido") ? "liquido" : "bruto";
const em = opcao("em") ?? hoje;
const filtroCustodia = (opcao("custodia") ?? "").toLowerCase();
const semPluggy = tem("sem-pluggy");

if (opcao("valor") && valor === null) {
  console.error(`Nao entendi o valor "${opcao("valor")}". Exemplos: 2mm, 2.000.000, 500k.`);
  process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(em)) {
  console.error(`--em precisa ser AAAA-MM-DD, veio "${em}".`);
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
  /* --- as posicoes ------------------------------------------------------ */

  const linhas = await banco.query(
    `SELECT id, institution, name_enc, amount, gross_amount, balance, taxes,
            quantity, unit_price, due_date, purchase_date, seen_at
       FROM investments
      ORDER BY due_date NULLS LAST, institution`,
  );

  const pedacosDoNome = alvoNome.toLowerCase().split(/\s+/).filter(Boolean);
  const posicoes = linhas
    .map((l) => ({
      id: l.id,
      custodia: l.institution,
      nome: abrir(l.name_enc) ?? "(sem nome)",
      aportado: l.amount === null ? null : Number(l.amount),
      bruto: Number(l.gross_amount ?? l.balance ?? 0),
      imposto: l.taxes === null ? null : Number(l.taxes),
      quantidade: l.quantity === null ? null : Number(l.quantity),
      precoUnitario: l.unit_price === null ? null : Number(l.unit_price),
      vence: dia(l.due_date),
      compradoEm: dia(l.purchase_date),
      vistoEm: dia(l.seen_at),
    }))
    .filter((p) => pedacosDoNome.every((x) => p.nome.toLowerCase().includes(x)))
    .filter((p) => !filtroCustodia || p.custodia.toLowerCase().includes(filtroCustodia));

  if (posicoes.length === 0) {
    const nomes = [...new Set(linhas.map((l) => abrir(l.name_enc)).filter(Boolean))].sort();
    console.error(
      `Nenhuma posicao com "${alvoNome}"${filtroCustodia ? ` na custodia "${filtroCustodia}"` : ""}.` +
        `\nO que existe na carteira:\n${nomes.map((n) => `  ${n}`).join("\n")}`,
    );
    process.exit(1);
  }

  /* --- o preco de hoje ---------------------------------------------------- */

  const precos = (
    await banco.query(
      `SELECT title, maturity, quoted_at, buy_rate, sell_rate, buy_price, sell_price
         FROM treasury_quotes`,
    )
  ).map((p) => ({
    titulo: p.title,
    vence: dia(p.maturity),
    base: dia(p.quoted_at),
    taxaCompra: Number(p.buy_rate),
    taxaVenda: Number(p.sell_rate),
    precoCompra: Number(p.buy_price),
    precoVenda: Number(p.sell_price),
  }));

  for (const p of posicoes) {
    const oficial = casarComOTitulo({ precoUnitario: p.precoUnitario, vence: p.vence }, precos);
    if (oficial) {
      p.preco = oficial.precoVenda;
      p.precoDe = `Tesouro, ${br(oficial.base)}`;
      p.precoBase = oficial.base;
      p.titulo = oficial.titulo;
    } else if (p.precoUnitario > 0) {
      p.preco = p.precoUnitario;
      p.precoDe = `${p.custodia} (sem preco oficial casado)`;
    } else if (p.quantidade > 0) {
      p.preco = p.bruto / p.quantidade;
      p.precoDe = `${p.custodia}, bruto / quantidade`;
    } else {
      p.preco = null;
      p.precoDe = "sem preco";
    }
  }

  /* --- as boletas --------------------------------------------------------- */

  if (!semPluggy) {
    try {
      await autenticar();
    } catch (erro) {
      console.error(
        `Pluggy indisponivel (${erro.message}).\n` +
          "Rode com --sem-pluggy para usar so as posicoes do banco — cada posicao vira\n" +
          "um lote unico, o que so esta certo se ela tiver uma compra so.",
      );
      process.exit(1);
    }
  }

  for (const p of posicoes) {
    if (!semPluggy) {
      const r = await movimentosDe(p.id);
      if (r.movimentos && r.movimentos.length > 0) {
        p.movimentos = r.movimentos;
        const aberto = lotesEmAberto(r.movimentos);
        p.lotes = aberto.lotes;
        p.sobra = aberto.sobra;
        p.fonte = "boletas da Pluggy";
        if (tem("bruto") && !posicoes.some((x) => x.mostrouBruto)) {
          p.mostrouBruto = true;
          console.log("\nUm movimento como a Pluggy mandou:\n");
          console.log(JSON.stringify(r.movimentos[0], null, 2));
        }
        continue;
      }
      p.motivoSemBoleta = r.erro ?? "a Pluggy nao devolveu movimento nenhum";
    }

    // Sem boleta: a posicao inteira vira um lote. So esta certo quando ela
    // teve uma compra so — e por isso a tela diz de onde veio.
    if (p.compradoEm && p.quantidade > 0 && p.aportado > 0) {
      p.lotes = [
        {
          compradoEm: p.compradoEm,
          quantidade: p.quantidade,
          original: p.quantidade,
          precoUnitario: p.aportado / p.quantidade,
          origem: "posicao",
          id: p.id,
        },
      ];
      p.fonte = "posicao consolidada (um lote so)";
    } else {
      p.lotes = [];
      p.fonte = "sem dado para montar lote";
    }
  }

  /*
   * Rotulo curto da fila. O ano vem do NOME do titulo: na Renda+, "2065" e o
   * ano da aposentadoria, e o vencimento da divida e vinte anos depois — usar
   * o vencimento chamaria a Renda+ 2065 de 2084.
   */
  const rotulo = (p) => {
    const ano = p.nome.match(/(\d{4})\s*$/)?.[1] ?? p.vence?.slice(0, 4) ?? "";
    return `[${posicoes.indexOf(p) + 1}] ${p.custodia} ${ano}`.trim();
  };

  /* --- historico -------------------------------------------------------- */

  console.log(`\nVenda simulada em ${br(em)}${em === hoje ? " (hoje)" : ""}.`);

  const filas = posicoes.filter((p) => p.lotes.length > 0 && p.preco > 0);

  posicoes.forEach((p, n) => {
    console.log(`\n${"═".repeat(78)}`);
    console.log(`[${n + 1}] ${p.nome} · ${p.custodia}`);
    console.log(
      `    ${numero(p.quantidade ?? 0, 2)} titulos · bruto ${dinheiro(p.bruto)}` +
        ` · vence ${br(p.vence)} · preco ${p.preco ? dinheiro(p.preco) : "—"} (${p.precoDe})`,
    );
    console.log(`    fonte dos lotes: ${p.fonte}${p.motivoSemBoleta ? ` — ${p.motivoSemBoleta}` : ""}`);

    if (p.movimentos) {
      console.log(`\n    Todos os movimentos (${p.movimentos.length}):\n`);
      tabela(
        ["data", "tipo", "quantidade", "preco unit.", "valor"],
        [...p.movimentos]
          .sort((a, b) =>
            String(a.tradeDate ?? a.date).localeCompare(String(b.tradeDate ?? b.date)),
          )
          .map((m) => [
            br(dia(m.tradeDate ?? m.date)),
            [m.type, m.movementType].filter(Boolean).join("/"),
            m.quantity == null ? "—" : numero(Number(m.quantity), 2),
            m.value == null ? "—" : dinheiro(Number(m.value)),
            dinheiro(Number(m.amount ?? m.netAmount ?? 0)),
          ]),
      );
    }

    if (p.lotes.length > 0) {
      const somaLotes = p.lotes.reduce((s, l) => s + l.quantidade, 0);
      console.log(`\n    Lotes em carteira, do mais antigo (sai primeiro) ao mais novo:\n`);
      tabela(
        ["comprado em", "titulos", "custo unit.", "dias", "IR", "ganho hoje", "IR se vender tudo"],
        p.lotes.map((l) => {
          const dias = diasEntre(l.compradoEm, em);
          const ganho = p.preco ? l.quantidade * (p.preco - l.precoUnitario) : null;
          return [
            br(l.compradoEm) + (l.origem === "transferencia" ? " *" : ""),
            numero(l.quantidade, 2),
            dinheiro(l.precoUnitario),
            dias,
            pct(aliquotaDeIr(dias)),
            ganho === null ? "—" : dinheiro(ganho),
            ganho === null ? "—" : dinheiro(Math.max(0, ganho) * aliquotaDeIr(dias)),
          ];
        }),
      );
      if (p.lotes.some((l) => l.origem === "transferencia")) {
        console.log(
          "\n    * transferencia de custodia: a data e a da transferencia, nao a da compra" +
            "\n      original. A aliquota real pode ser MENOR que a mostrada.",
        );
      }
      if (p.quantidade > 0 && Math.abs(somaLotes - p.quantidade) > 0.005) {
        console.log(
          `\n    ! Os lotes somam ${numero(somaLotes, 2)} titulos e a posicao tem ${numero(p.quantidade, 2)}.` +
            "\n      O historico da Pluggy nao cobre tudo — a simulacao usa so o que esta nos lotes.",
        );
      }
      if (p.sobra > 0) {
        console.log(
          `\n    ! Ha ${numero(p.sobra, 2)} titulos vendidos sem compra correspondente: o historico` +
            "\n      comeca depois da primeira compra.",
        );
      }
    }
  });

  if (!valor) {
    console.log(
      `\n${"═".repeat(78)}\nPara simular a venda: npm run resgate -- --valor 2mm` +
        (filas.length > 1 ? " [--custodia <nome>]" : ""),
    );
    process.exit(0);
  }

  /* --- a venda ------------------------------------------------------------ */

  console.log(`\n${"═".repeat(78)}`);
  console.log(
    `VENDA DE ${dinheiro(valor)} ${modo === "liquido" ? "LIQUIDOS (na conta, ja sem imposto)" : "BRUTOS"}`,
  );
  console.log(
    "\nPEPS vale dentro de cada titulo e custodia. Cada fila abaixo e simulada" +
      "\nsozinha, como se os R$ saissem todos dela.",
  );

  const resumo = [];

  for (const p of filas) {
    const s = simularVenda(p.lotes, { preco: p.preco, em, alvo: valor, modo });

    console.log(`\n${rotulo(p)} · ${p.nome}`);
    tabela(
      ["comprado em", "titulos", "bruto", "custo", "ganho", "dias", "IR", "IOF", "imposto", "liquido"],
      s.pedacos.map((x) => [
        br(x.compradoEm) + (x.origem === "transferencia" ? " *" : ""),
        numero(x.quantidadeVendida, 2) + (x.quantidadeVendida < x.quantidade - 1e-8 ? " de " + numero(x.quantidade, 2) : ""),
        dinheiro(x.bruto),
        dinheiro(x.custo),
        dinheiro(x.ganho),
        x.dias,
        pct(x.aliqIr),
        x.iof > 0 ? dinheiro(x.iof) : "—",
        dinheiro(x.ir + x.iof),
        dinheiro(x.liquido),
      ]),
    );
    console.log(
      `\n    ${numero(s.quantidade, 2)} titulos a ${dinheiro(p.preco)}: bruto ${dinheiro(s.bruto)},` +
        ` ganho ${dinheiro(s.ganho)}, IR ${dinheiro(s.ir)}` +
        (s.iof > 0 ? `, IOF ${dinheiro(s.iof)}` : "") +
        `, liquido ${dinheiro(s.liquido)}.`,
    );
    if (s.ganho > 0) {
      console.log(`    Aliquota efetiva sobre o ganho: ${pct(s.ir / s.ganho)}.`);
    }
    if (s.insuficiente) {
      console.log(
        `    ! Esta fila so tem ${dinheiro(s.disponivel * p.preco)} brutos: nao cobre o valor pedido.`,
      );
    }
    if (s.prejuizo < 0) {
      console.log(
        `    ! ${dinheiro(-s.prejuizo)} de prejuizo em lotes desta venda. O IR acima nao` +
          `\n      compensa um lote com outro; se a B3 compensar, fica perto de ${dinheiro(s.irSeCompensar)}.`,
      );
    }

    const esperas = economiaEsperando(s);
    if (esperas.length > 0) {
      console.log("\n    Esperar o degrau, com o mesmo preco, economizaria:");
      for (const e of esperas) {
        console.log(
          `      lote de ${br(e.compradoEm)}: em ${br(e.dia)} cai de ${pct(e.de)} para ${pct(e.para)}` +
            ` → ${dinheiro(e.economia)}`,
        );
      }
    }

    resumo.push({ p, s });
  }

  if (resumo.length > 1) {
    console.log(`\n${"═".repeat(78)}\nComparando as filas para ${dinheiro(valor)}:\n`);
    tabela(
      ["fila", "cobre?", "imposto", "liquido", "aliq. efetiva"],
      resumo.map(({ p, s }) => [
        rotulo(p),
        s.insuficiente ? "nao" : "sim",
        dinheiro(s.ir + s.iof),
        dinheiro(s.liquido),
        s.ganho > 0 ? pct((s.ir + s.iof) / s.ganho) : "—",
      ]),
    );

    /* --- plano combinado ---------------------------------------------- */

    const plano = planoCombinado(
      filas.map((p) => ({ chave: p.id, lotes: p.lotes, preco: p.preco })),
      { em, alvo: valor, modo },
    );

    console.log(
      `\n${"═".repeat(78)}\nPLANO COMBINADO — o menor imposto para ${dinheiro(valor)}` +
        `${modo === "liquido" ? " liquidos" : ""}` +
        "\n\nA cada passo sai o lote da frente de alguma fila — o que paga menos imposto" +
        "\npor real vendido. Uma ordem de venda por fila:\n",
    );

    for (const { chave: id, simulacao: s } of plano.ordens) {
      const p = filas.find((f) => f.id === id);
      console.log(
        `  ${rotulo(p)}: vender ${numero(s.quantidade, 2)} titulos` +
          ` (${dinheiro(s.bruto)} brutos, imposto ${dinheiro(s.ir + s.iof)})`,
      );
      for (const x of s.pedacos) {
        console.log(
          `      ${br(x.compradoEm)}${x.origem === "transferencia" ? " *" : "  "}` +
            `  ${numero(x.quantidadeVendida, 2).padStart(10)} tit.` +
            `  ganho ${dinheiro(x.ganho).padStart(16)}` +
            `  ${pct(x.aliqIr).padStart(6)}` +
            `  imposto ${dinheiro(x.ir + x.iof).padStart(14)}`,
        );
      }
    }

    console.log(
      `\n  Total: bruto ${dinheiro(plano.bruto)}, ganho ${dinheiro(plano.ganho)},` +
        ` imposto ${dinheiro(plano.ir + plano.iof)}, liquido ${dinheiro(plano.liquido)}.`,
    );
    if (plano.ganho > 0) {
      console.log(`  Aliquota efetiva sobre o ganho: ${pct((plano.ir + plano.iof) / plano.ganho)}.`);
    }
    if (plano.insuficiente) {
      console.log("  ! Nem somando todas as filas a carteira cobre o valor pedido.");
    }
  }

  const velho = filas.find((p) => p.precoBase && diasEntre(p.precoBase, hoje) > 4);
  if (velho) {
    console.log(
      `\n! O preco oficial e de ${br(velho.precoBase)}. Rode \`npm run tesouro\` para atualizar.`,
    );
  }

  console.log(
    "\nFora da conta: taxa de custodia da B3 e taxa da corretora, cobradas na venda" +
      "\ne dedutiveis da base do IR. A Renda+ tem regra propria de custodia para quem" +
      "\nvende antes da conversao — confira na corretora antes de vender.",
  );
} finally {
  await banco.fim?.();
}
