import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Quem pode abrir cada porta do app.
 *
 * Teste estatico, sobre o codigo-fonte, de proposito: a assistente ver uma tela
 * a mais e o tipo de erro que nenhum teste de comportamento pega, porque
 * ninguem escreve o teste da pagina que esqueceu de proteger. Aqui toda
 * pagina, rota e acao entra sozinha na lista, e a que nao declarar guarda
 * nenhuma — ou declarar a da assistente sem estar na lista abaixo — quebra.
 */

const APP = path.join(process.cwd(), "src", "app");

/** Onde a assistente pode entrar. Aumentar esta lista e uma decisao, nao um ajuste. */
const DA_ASSISTENTE = [
  "assistente/page.tsx",
  "assistente/actions.ts",
  "assistente/lote/[id]/page.tsx",
  "api/importar/print/route.ts",
  "api/anexos/route.ts",
  "api/anexos/[id]/route.ts",
].sort();

/**
 * Sem guarda de sessao, cada uma pelo seu motivo: a tela de entrada e as
 * rotas de autenticacao existem antes da sessao; a sincronizacao aceita o
 * segredo do cron e confere o papel por conta propria.
 */
const SEM_GUARDA = [
  "entrar/page.tsx",
  "api/auth/entrar/route.ts",
  "api/auth/registrar/route.ts",
  "api/auth/dispositivo/route.ts",
  "api/auth/sair/route.ts",
  "api/sync/route.ts",
].sort();

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = path.join(dir, nome);
    if (statSync(caminho).isDirectory()) return nome === "__tests__" ? [] : arquivos(caminho);
    return [caminho];
  });
}

const portas = arquivos(APP)
  .filter((f) => /(?:^|\/)(page\.tsx|route\.ts)$/.test(f) || /\/actions\.ts$/.test(f) || f.endsWith(`${path.sep}actions.ts`))
  .map((f) => ({ rel: path.relative(APP, f).split(path.sep).join("/"), codigo: readFileSync(f, "utf8") }));

describe("controle de acesso por arquivo", () => {
  it("acha as portas do app", () => {
    expect(portas.length).toBeGreaterThan(20);
  });

  it("toda pagina, rota e acao declara quem pode entrar", () => {
    const soltas = portas
      .filter((p) => !SEM_GUARDA.includes(p.rel))
      .filter(
        (p) =>
          !p.codigo.includes("await requireSession()") &&
          !p.codigo.includes("await requireAcessoDaAssistente()"),
      )
      .map((p) => p.rel);
    expect(soltas).toEqual([]);
  });

  it("so as portas listadas aceitam a assistente", () => {
    const abertas = portas
      .filter((p) => p.codigo.includes("requireAcessoDaAssistente"))
      .map((p) => p.rel)
      .sort();
    expect(abertas).toEqual(DA_ASSISTENTE);
  });

  it("acoes de servidor: cada funcao exportada abre com a guarda", () => {
    // Uma acao e uma porta propria: o arquivo ter a guarda em OUTRA funcao
    // nao protege esta.
    const faltando: string[] = [];
    for (const p of portas.filter((x) => x.rel.endsWith("actions.ts"))) {
      const funcoes = p.codigo.split(/\nexport async function /).slice(1);
      for (const corpo of funcoes) {
        const nome = corpo.slice(0, corpo.indexOf("("));
        const inicio = corpo.slice(0, corpo.indexOf("\n}\n") > 0 ? corpo.indexOf("\n}\n") : undefined);
        if (!/await (requireSession|requireAcessoDaAssistente)\(\)/.test(inicio)) {
          faltando.push(`${p.rel}:${nome}`);
        }
      }
    }
    expect(faltando).toEqual([]);
  });

  it("rotas sem guarda conferem o papel do dono quando usam a sessao", () => {
    for (const rel of ["api/auth/dispositivo/route.ts", "api/sync/route.ts"]) {
      const codigo = portas.find((p) => p.rel === rel)!.codigo;
      expect(codigo).toMatch(/papel\s*(!==|===)\s*"dono"/);
    }
  });
});
