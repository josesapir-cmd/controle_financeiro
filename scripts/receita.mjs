#!/usr/bin/env node
/**
 * A remuneracao que o extrato nao explica.
 *
 * O banco mostra um credito vindo de uma empresa. Ele nao mostra que foi 3,15%
 * de um lucro de trinta e tres milhoes, nem que plano de saude e adiantamento
 * sairam antes, nem a que trimestre aquilo se refere. Isso so existe no aviso
 * de pagamento, e e o que esta tabela guarda.
 *
 * Os numeros NAO estao aqui dentro, de proposito: remuneracao pessoal nao entra
 * em repositorio. Eles vivem num CSV fora do projeto, e este script importa.
 *
 * Uso:
 *   node scripts/receita.mjs                          lista o que esta cadastrado
 *   node scripts/receita.mjs --importar ~/receitas.csv
 *   node scripts/receita.mjs --conferir               cruza com os creditos do extrato
 *
 * O CSV usa ponto e virgula, virgula decimal e estas colunas:
 *   fonte;trimestre;competencia;pago_em;pct;lucro_a_distribuir;
 *   bruto;plano_saude;adiantamentos;ir_retido;liquido
 *
 * `plano_saude` e `adiantamentos` vao negativos (saem do bruto); `ir_retido`
 * vai positivo (e credito). Linha sem `bruto` numerico e ignorada, para o
 * arquivo poder carregar as lacunas anotadas sem virar lixo no banco.
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { cifrarCom, decifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
import { fingerprintWith } from "../src/lib/fingerprint.mjs";

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
          process.env[chave] = limpa
            .slice(igual + 1)
            .trim()
            .replace(/^["']|["']$/g, "");
        }
      }
    } catch {}
  }
}

/**
 * O dia em ISO, venha ele como `Date` ou como texto.
 *
 * O driver devolve `date` como objeto `Date`, e `String(data).slice(0, 10)` da
 * "Fri Aug 2" — um relatorio errado de cara certa.
 */
function emIso(valor) {
  if (!valor) return null;
  return valor instanceof Date
    ? valor.toISOString().slice(0, 10)
    : String(valor).slice(0, 10);
}

/** Aceita "1.234,56", "1234.56" e "-21.691,98" — ninguem digita do mesmo jeito. */
function numero(texto) {
  if (texto === null || texto === undefined) return null;
  const limpo = String(texto).replace(/[R$\s%]/g, "");
  if (!limpo || !/\d/.test(limpo)) return null;
  const normalizado =
    limpo.lastIndexOf(",") > limpo.lastIndexOf(".")
      ? limpo.replace(/\./g, "").replace(",", ".")
      : limpo.replace(/,/g, "");
  const valor = Number(normalizado);
  return Number.isFinite(valor) ? valor : null;
}

const dinheiro = (v) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Primeiro dia do trimestre a partir do rotulo: "3T2025" vira "2025-07-01".
 *
 * A competencia nao esta no CSV como data porque ninguem digita isso a mao sem
 * errar; o rotulo e o que vem do aviso, e a data sai dele.
 */
function competenciaDoRotulo(rotulo) {
  const casa = /^([1-4])\s*T\s*(\d{4})$/i.exec(rotulo.trim());
  if (!casa) return null;
  const mes = String((Number(casa[1]) - 1) * 3 + 1).padStart(2, "0");
  return `${casa[2]}-${mes}-01`;
}

/** Sem acento e sem caixa, para casar "Atmos Capital" com "ATMOS CAPITAL LTDA". */
function simplificar(texto) {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

const argumentos = process.argv.slice(2);
function opcao(nome) {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? null : (argumentos[i + 1] ?? null);
}

await lerEnv();

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
  const arquivo = opcao("importar");

  if (arquivo) {
    const bruto = await readFile(path.resolve(arquivo), "utf8");
    const linhas = bruto.split(/\r?\n/).filter((l) => l.trim());
    if (linhas.length < 2) {
      console.error("o arquivo nao tem nenhuma linha alem do cabecalho.");
      process.exit(1);
    }

    const colunas = linhas[0].split(";").map((c) => c.trim().toLowerCase());
    const indice = (nome) => colunas.indexOf(nome);
    const faltando = [
      "fonte",
      "trimestre",
      "bruto",
      "liquido",
    ].filter((c) => indice(c) === -1);

    if (faltando.length > 0) {
      console.error(`faltam colunas no cabecalho: ${faltando.join(", ")}`);
      process.exit(1);
    }

    let gravadas = 0;
    let puladas = 0;

    for (const linha of linhas.slice(1)) {
      const campos = linha.split(";");
      const em = (nome) => {
        const i = indice(nome);
        return i === -1 ? null : (campos[i] ?? "").trim();
      };

      const fonte = em("fonte");
      const rotulo = em("trimestre");
      const gross = numero(em("bruto"));
      const net = numero(em("liquido"));

      // Linha de lacuna ("NAO ENCONTRADO", trimestre sem dado) passa batido:
      // o arquivo serve tambem como mapa do que falta, e recusar o import
      // inteiro por causa dela obrigaria a manter duas versoes do mesmo CSV.
      if (!fonte || !rotulo || gross === null || net === null) {
        puladas += 1;
        continue;
      }

      const competencia = em("competencia") || competenciaDoRotulo(rotulo);
      if (!competencia || !ISO.test(competencia)) {
        console.error(
          `${rotulo}: nao consegui a competencia. Use a coluna "competencia" com AAAA-MM-DD.`,
        );
        process.exit(1);
      }

      const pagoEm = em("pago_em");
      if (pagoEm && !ISO.test(pagoEm)) {
        console.error(`${rotulo}: "pago_em" precisa ser AAAA-MM-DD; recebi "${pagoEm}".`);
        process.exit(1);
      }

      const plano = numero(em("plano_saude")) ?? 0;
      const acertos = numero(em("adiantamentos")) ?? 0;
      const retido = numero(em("ir_retido")) ?? 0;

      // Descontos negativos e retencao positiva e o que a invariante assume.
      // Um sinal trocado fecharia a conta errada e ninguem veria.
      const fechamento = gross + plano + acertos - Math.abs(retido);
      if (Math.abs(fechamento - net) > 0.02) {
        console.error(
          `${rotulo}: a conta nao fecha. ` +
            `bruto ${dinheiro(gross)} + descontos ${dinheiro(plano + acertos)} ` +
            `- IR ${dinheiro(Math.abs(retido))} = ${dinheiro(fechamento)}, ` +
            `mas o liquido informado e ${dinheiro(net)}.`,
        );
        process.exit(1);
      }

      await banco.query(
        `INSERT INTO partner_income
           (source_enc, source_fingerprint, period_label, period_start, paid_on,
            share_pct, distributable, gross, health_plan, settlements,
            withheld_tax, net, note_enc)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (source_fingerprint, period_label) DO UPDATE
           SET source_enc = EXCLUDED.source_enc,
               period_start = EXCLUDED.period_start,
               paid_on = EXCLUDED.paid_on,
               share_pct = EXCLUDED.share_pct,
               distributable = EXCLUDED.distributable,
               gross = EXCLUDED.gross,
               health_plan = EXCLUDED.health_plan,
               settlements = EXCLUDED.settlements,
               withheld_tax = EXCLUDED.withheld_tax,
               net = EXCLUDED.net,
               note_enc = EXCLUDED.note_enc,
               updated_at = now()`,
        [
          cifrarCom(chave, fonte),
          fingerprintWith(chave, "receita-de-socio", fonte),
          rotulo,
          competencia,
          pagoEm || null,
          numero(em("pct")),
          numero(em("lucro_a_distribuir")),
          gross,
          plano,
          acertos,
          Math.abs(retido),
          net,
          em("nota") ? cifrarCom(chave, em("nota")) : null,
        ],
      );

      gravadas += 1;
    }

    console.log(
      `${gravadas} periodo(s) gravado(s)` +
        (puladas > 0 ? `, ${puladas} linha(s) sem valor ignorada(s).` : "."),
    );
  }

  const linhas = await banco.query(
    `SELECT id, source_enc, period_label, period_start, paid_on, share_pct,
            distributable, gross, health_plan, settlements, withheld_tax, net
       FROM partner_income
      ORDER BY period_start`,
  );

  if (linhas.length === 0) {
    console.log("\nnenhuma receita cadastrada. use --importar.");
    process.exit(0);
  }

  console.log(`\n${linhas.length} periodo(s)\n`);
  console.log(
    "  periodo   pago em      participacao          bruto        liquido     IR retido",
  );

  let bruto = 0;
  let liquido = 0;
  let retido = 0;
  const porAnoDeCaixa = new Map();

  for (const l of linhas) {
    const g = Number(l.gross);
    const n = Number(l.net);
    const r = Number(l.withheld_tax);
    bruto += g;
    liquido += n;
    retido += r;

    const pago = emIso(l.paid_on);
    if (pago) {
      porAnoDeCaixa.set(
        pago.slice(0, 4),
        (porAnoDeCaixa.get(pago.slice(0, 4)) ?? 0) + n,
      );
    }

    const pct = l.share_pct === null ? "" : `${Number(l.share_pct).toFixed(2)}%`;
    console.log(
      `  ${String(l.period_label).padEnd(9)} ` +
        `${(pago ?? "—").padEnd(12)} ` +
        `${pct.padStart(6)}  ` +
        `${dinheiro(g).padStart(16)} ` +
        `${dinheiro(n).padStart(14)} ` +
        `${(r > 0 ? dinheiro(r) : "—").padStart(13)}`,
    );
  }

  console.log(
    `\n  TOTAL                        ` +
      `${dinheiro(bruto).padStart(16)} ` +
      `${dinheiro(liquido).padStart(14)} ` +
      `${dinheiro(retido).padStart(13)}`,
  );

  if (porAnoDeCaixa.size > 0) {
    console.log("\n  recebido por ano (regime de caixa)");
    for (const ano of [...porAnoDeCaixa.keys()].sort()) {
      console.log(`    ${ano}  ${dinheiro(porAnoDeCaixa.get(ano)).padStart(16)}`);
    }
  }

  if (!argumentos.includes("--conferir")) {
    console.log(
      "\n  --conferir cruza estes pagamentos com os creditos do extrato.",
    );
    process.exit(0);
  }

  /* ---- conferencia contra o extrato ---------------------------------------
     Estes pagamentos NAO entram em nenhum relatorio de receita: os recentes ja
     estao no extrato sincronizado, e soma-los de novo contaria o mesmo dinheiro
     duas vezes. O que falta saber e quais ja estao la — e e isso que segue. */

  const creditos = await banco.query(
    `SELECT t.local_day, t.amount, t.counterparty_name_enc, t.description_enc,
            a.connector_name
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE t.amount > 0`,
  );

  console.log("\n  conferencia com o extrato\n");

  let achados = 0;
  for (const l of linhas) {
    const pago = emIso(l.paid_on);
    const n = Number(l.net);
    if (!pago || n < 0.005) continue;

    const fonte = simplificar(abrir(l.source_enc) ?? "");
    const alvo = new Date(`${pago}T00:00:00Z`).getTime();

    // Janela de tres dias: o aviso diz "pago em 13/04" e a TED as vezes cai no
    // dia util seguinte. Casar so pelo dia exato perderia metade.
    const candidatos = creditos.filter((c) => {
      const dia = emIso(c.local_day);
      if (!dia) return false;
      const distancia = Math.abs(
        (new Date(`${dia}T00:00:00Z`).getTime() - alvo) / 86400000,
      );
      return distancia <= 3 && Math.abs(Number(c.amount) - n) < 0.02;
    });

    const mesmaFonte = candidatos.filter((c) =>
      simplificar(abrir(c.counterparty_name_enc) ?? "").includes(
        fonte.split(" ")[0] ?? "",
      ),
    );

    const casou = mesmaFonte[0] ?? candidatos[0] ?? null;

    if (casou) {
      achados += 1;
      console.log(
        `  ${String(l.period_label).padEnd(9)} ${dinheiro(n).padStart(16)}  ` +
          `ja no extrato — ${emIso(casou.local_day)} · ${casou.connector_name}`,
      );
    } else {
      console.log(
        `  ${String(l.period_label).padEnd(9)} ${dinheiro(n).padStart(16)}  ` +
          `sem credito equivalente no extrato`,
      );
    }
  }

  console.log(
    `\n  ${achados} de ${linhas.filter((l) => l.paid_on).length} pagamento(s) ` +
      `encontrados no extrato.`,
  );
  console.log(
    "  Os que estao la ja contam como receita pelo extrato; esta tabela nao soma\n" +
      "  em relatorio nenhum, so guarda a competencia, a participacao e o IR.",
  );
} finally {
  await banco.fim?.();
}
