#!/usr/bin/env node
/**
 * O que esta guardado na tabela de posicoes, cru.
 *
 * Existe para uma pergunta especifica: "por que dois papeis identicos na tela
 * nao viraram uma linha so?". A tela agrupa por nome e vencimento, e nome e
 * texto cifrado — dois lotes que parecem iguais podem diferir num espaco a
 * mais, e nenhuma tela mostra isso. Aqui o nome sai entre colchetes e o
 * agrupamento e mostrado do jeito que o codigo o calcula.
 *
 * E onde se declara que dois nomes sao o mesmo papel. A mesma NTN-B chega como
 * "NTN-B1" na XP e "TESOURO DIRETO - NTN-B1" no BTG; nenhuma regra de texto
 * junta isso sem risco, porque dois bancos emitem CDB de mesmo vencimento e sao
 * papeis diferentes. Quem decide e quem sabe.
 *
 * Uso:
 *   node scripts/carteira.mjs
 *   node scripts/carteira.mjs --unir "NTN-B1" --como "Renda+ 2065"
 *   node scripts/carteira.mjs --separar "NTN-B1"
 *   node scripts/carteira.mjs --unir-classe CDB
 *   node scripts/carteira.mjs --unir-classe CDB --como "CDB dos bancos"
 *   node scripts/carteira.mjs --precos         quantidade, PU e o que a venda daria
 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { abrirBanco } from "./conectar.mjs";
import { morrerComExplicacao } from "./erro-de-banco.mjs";
import { decifrarCom, cifrarCom, lerChaveDoAmbiente } from "../src/lib/cifra.mjs";
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

const dinheiro = (v) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const argumentos = process.argv.slice(2);

function opcao(nome) {
  const i = argumentos.indexOf(`--${nome}`);
  return i === -1 ? null : (argumentos[i + 1] ?? null);
}

const dia = (v) =>
  !v ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

await lerEnv();

const chave = lerChaveDoAmbiente();
const banco = await abrirBanco().catch(morrerComExplicacao);

/**
 * O mesmo fingerprint que o app gera — no repositorio ele se chama
 * `instrumentFingerprint`. `fingerprintWith` ja apara e baixa a caixa por
 * dentro; repetir isso aqui daria outro valor e a uniao nao casaria.
 */
const fp = (nome) => fingerprintWith(chave, "instrumento", nome);

/** Nome ilegivel nao derruba a listagem: uma linha sem nome ainda tem saldo. */
const abrir = (v) => {
  if (!v) return null;
  try {
    return decifrarCom(chave, v);
  } catch {
    return null;
  }
};

try {
  const unir = opcao("unir");
  const como = opcao("como");
  const separar = opcao("separar");
  const unirClasse = opcao("unir-classe");
  if (unirClasse) {
    // A declaracao por classe vira uma decisao por nome, e nao uma regra
    // guardada: regra pegaria sozinha o CDB que chegar amanha, e quem nao
    // lembra da regra so veria um total mudar. Decisao por nome fica escrita,
    // da para listar e da para desfazer uma a uma.
    const alvo = unirClasse.toUpperCase();
    const encontradas = await banco.query(
      `SELECT DISTINCT name_enc FROM investments
        WHERE upper(coalesce(subtype, '')) = $1 OR upper(type) = $1`,
      [alvo],
    );

    const apelido = (como ?? unirClasse).trim();
    const nomes = encontradas.map((l) => abrir(l.name_enc)).filter(Boolean);

    if (nomes.length === 0) {
      console.error(`Nenhuma posicao com tipo ou subtipo "${unirClasse}".`);
      process.exit(1);
    }

    for (const nome of nomes) {
      await banco.query(
        `INSERT INTO instrument_aliases (fingerprint, alias_fingerprint, alias_enc, raw_name_enc)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (fingerprint) DO UPDATE
           SET alias_fingerprint = EXCLUDED.alias_fingerprint,
               alias_enc = EXCLUDED.alias_enc,
               raw_name_enc = EXCLUDED.raw_name_enc,
               decided_at = now()`,
        [fp(nome), fp(apelido), cifrarCom(chave, apelido), cifrarCom(chave, nome)],
      );
      console.log(`  ${nome}  ->  ${apelido}`);
    }
    console.log(`\n${nomes.length} papel(eis) agora aparecem como "${apelido}".\n`);
  }

  if (separar) {
    await banco.query("DELETE FROM instrument_aliases WHERE fingerprint = $1", [fp(separar)]);
    console.log(`"${separar}" voltou a ser papel proprio.\n`);
  }

  if (unir) {
    if (!como) {
      console.error('Diga com que nome: --unir "NTN-B1" --como "Renda+ 2065"');
      process.exit(1);
    }

    await banco.query(
      `INSERT INTO instrument_aliases (fingerprint, alias_fingerprint, alias_enc, raw_name_enc)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (fingerprint) DO UPDATE
         SET alias_fingerprint = EXCLUDED.alias_fingerprint,
             alias_enc = EXCLUDED.alias_enc,
             raw_name_enc = EXCLUDED.raw_name_enc,
             decided_at = now()`,
      [fp(unir), fp(como), cifrarCom(chave, como.trim()), cifrarCom(chave, unir.trim())],
    );
    console.log(`"${unir}" agora aparece como "${como}".\n`);
  }

  if (argumentos.includes("--precos")) {
    /* A conciliacao contra a tela da corretora.
     *
     * O preco que a instituicao manda ja e o de RECOMPRA: bruto = quantidade x
     * PU e o que a venda de hoje produz, e liquido e isso menos o imposto. A
     * duvida que este modo tira e se todas as custodias marcam assim mesmo —
     * uma que mande o preco de COMPRA infla o patrimonio sem avisar, e num
     * titulo longo a diferenca e de por cento, nao de centavos. */
    const posicoes = await banco.query(
      `SELECT institution, name_enc, quantity, unit_price, gross_amount, taxes,
              balance, fixed_annual_rate
         FROM investments
        ORDER BY COALESCE(gross_amount, balance) DESC NULLS LAST`,
    );

    if (posicoes.length === 0) {
      console.log("Nenhuma posicao guardada. Sincronize em Conexoes.");
      process.exit(0);
    }

    const apelidosPreco = new Map(
      (await banco.query("SELECT fingerprint, alias_enc FROM instrument_aliases")).map(
        (a) => [a.fingerprint, abrir(a.alias_enc)],
      ),
    );

    const porInstrumento = new Map();
    let semPreco = 0;

    for (const p of posicoes) {
      const cru = abrir(p.name_enc) ?? "(sem nome)";
      const nome = apelidosPreco.get(fp(cru)) ?? cru;
      const qtd = p.quantity === null ? null : Number(p.quantity);
      const pu = p.unit_price === null ? null : Number(p.unit_price);
      const bruto = Number(p.gross_amount ?? p.balance ?? 0);
      const liquido = Number(p.balance ?? 0);
      if (qtd === null || pu === null) semPreco += 1;

      const g = porInstrumento.get(nome) ?? {
        qtd: 0, bruto: 0, liquido: 0, imposto: 0, custodias: new Map(),
      };
      g.qtd += qtd ?? 0;
      g.bruto += bruto;
      g.liquido += liquido;
      g.imposto += Number(p.taxes ?? 0);
      const c = g.custodias.get(p.institution) ?? { qtd: 0, bruto: 0, pu: null };
      c.qtd += qtd ?? 0;
      c.bruto += bruto;
      // O PU e do papel, nao do lote: qualquer um serve para comparar curvas.
      c.pu = c.pu ?? pu;
      g.custodias.set(p.institution, c);
      porInstrumento.set(nome, g);
    }

    console.log("\nQuantidade, preco unitario e o que a venda de hoje daria.\n");

    for (const [nome, g] of [...porInstrumento].sort((a, b) => b[1].bruto - a[1].bruto)) {
      console.log(`  ${nome}`);
      // O PU medio sai do proprio total: e o preco que reproduz o bruto.
      const puMedio = g.qtd > 0 ? g.bruto / g.qtd : null;
      console.log(
        `    ${g.qtd > 0 ? `${g.qtd.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} titulos` : "sem quantidade"}` +
          `${puMedio !== null ? `   PU medio ${puMedio.toFixed(2)}` : ""}`,
      );
      console.log(
        `    bruto ${dinheiro(g.bruto)}   IR ${dinheiro(g.imposto)}` +
          `   liquido ${dinheiro(g.liquido)}`,
      );
      if (g.custodias.size > 1) {
        for (const [inst, c] of [...g.custodias].sort((a, b) => b[1].bruto - a[1].bruto)) {
          console.log(
            `      ${inst.padEnd(16)} ${dinheiro(c.bruto).padStart(18)}` +
              `${c.pu !== null ? `   PU ${Number(c.pu).toFixed(2)}` : "   sem PU"}`,
          );
        }
        // Custodias do mesmo papel marcando precos diferentes e o sintoma de
        // uma delas estar na curva de compra em vez da de recompra.
        const precos = [...g.custodias.values()].map((c) => c.pu).filter((x) => x !== null);
        if (precos.length > 1) {
          const menor = Math.min(...precos.map(Number));
          const maior = Math.max(...precos.map(Number));
          if (maior / menor - 1 > 0.005) {
            console.log(
              `      !! PU difere ${(((maior / menor) - 1) * 100).toFixed(2)}% entre custodias —` +
                ` alguma pode estar marcando na curva de compra.`,
            );
          }
        }
      }
      console.log();
    }

    const totalBruto = [...porInstrumento.values()].reduce((s, g) => s + g.bruto, 0);
    const totalLiq = [...porInstrumento.values()].reduce((s, g) => s + g.liquido, 0);
    console.log(`  TOTAL  bruto ${dinheiro(totalBruto)}   liquido ${dinheiro(totalLiq)}`);
    if (semPreco > 0) {
      console.log(
        `\n  ${semPreco} posicao(oes) sem quantidade ou preco unitario. Sao os campos` +
          ` da migracao 022:\n  rode npm run migrate e sincronize de novo em Conexoes.`,
      );
    }
    process.exit(0);
  }

  const linhas = await banco.query(
    `SELECT id, institution, type, subtype, name_enc, balance, due_date, seen_at
       FROM investments
      ORDER BY balance DESC NULLS LAST`,
  );

  if (linhas.length === 0) {
    console.log("Nenhuma posicao guardada.");
    console.log("Rode a migracao (npm run migrate) e depois uma sincronizacao em Conexoes.");
    process.exit(0);
  }

  const apelidos = new Map(
    (await banco.query("SELECT fingerprint, alias_enc FROM instrument_aliases")).map((a) => [
      a.fingerprint,
      abrir(a.alias_enc),
    ]),
  );

  const grupos = new Map();
  console.log(`${linhas.length} posicao(oes)\n`);

  for (const linha of linhas) {
    const cru = abrir(linha.name_enc) ?? "(sem nome)";
    const apelido = apelidos.get(fp(cru)) ?? null;
    const nome = apelido ?? cru;
    const vence = dia(linha.due_date);
    // A mesma chave que `agruparPapeis` usa. Se duas linhas que deveriam somar
    // mostram chaves diferentes, a diferenca esta escrita aqui.
    const chaveDoGrupo = apelido
      ? `apelido|${nome.trim().replace(/\s+/g, " ").toUpperCase()}`
      : `${nome.trim().replace(/\s+/g, " ").toUpperCase()}|${vence}`;

    // Colchetes para o espaco sobrando aparecer.
    console.log(`  [${cru}]${apelido ? `  ->  ${apelido}` : ""}`);
    console.log(
      `     ${dinheiro(Number(linha.balance ?? 0)).padEnd(18)} ${linha.type}` +
        `${linha.subtype ? `/${linha.subtype}` : ""} · ${linha.institution}` +
        `${vence ? ` · vence ${vence}` : ""}`,
    );

    const atual = grupos.get(chaveDoGrupo) ?? { n: 0, total: 0, custodias: new Set(), nome };
    atual.n += 1;
    atual.total += Number(linha.balance ?? 0);
    atual.custodias.add(linha.institution);
    grupos.set(chaveDoGrupo, atual);
  }

  console.log(`\n${grupos.size} linha(s) depois do agrupamento:\n`);
  for (const [chaveDoGrupo, g] of [...grupos].sort((a, b) => b[1].total - a[1].total)) {
    console.log(
      `  ${dinheiro(g.total).padStart(18)}   ${g.n} posicao(oes)` +
        `   ${g.custodias.size} custodia(s)   ${g.nome}`,
    );
  }

  if (grupos.size === linhas.length && linhas.length > 1) {
    console.log(
      "\nNenhum agrupamento aconteceu. Compare os nomes entre colchetes acima: quando a\n" +
        'custodia escreve o mesmo papel de outro jeito, una com --unir "<nome>" --como "<apelido>".',
    );
  }
} finally {
  await banco.fim?.();
}
