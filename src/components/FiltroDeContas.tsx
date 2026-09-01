import Link from "next/link";
import { corDaInstituicao } from "@/lib/finance/cores-de-conta";
import type { AccountOption } from "@/lib/finance/service";

/**
 * Filtro de contas sempre aberto, em linha.
 *
 * Diferente do menu de `<details>` das outras abas: aqui o filtro tambem e a
 * legenda das cores da linha do tempo, e legenda escondida atras de um clique
 * nao e legenda. Cada instituicao e um botao que liga e desliga sozinho — um
 * clique, um link, sem "Aplicar".
 *
 * Nenhuma marcada significa TODAS. E o estado inicial e tambem o unico jeito de
 * a tela nunca ficar vazia por acidente: desmarcar a ultima volta para todas.
 *
 * O estado continua na URL, entao a visao filtrada e compartilhavel, o botao
 * voltar funciona e nada disso precisa de JavaScript no cliente.
 */
export function FiltroDeContas({
  options,
  selected,
  action,
  extra = {},
}: {
  options: AccountOption[];
  selected: string[];
  /** Rota da propria aba. */
  action: string;
  /** Parametros que precisam sobreviver a troca de filtro. */
  extra?: Record<string, string | undefined>;
}) {
  if (options.length === 0) return null;

  const porBanco = new Map<string, AccountOption[]>();
  for (const opcao of options) {
    const lista = porBanco.get(opcao.connectorName) ?? [];
    lista.push(opcao);
    porBanco.set(opcao.connectorName, lista);
  }

  const bancos = [...porBanco.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));

  const base = Object.entries(extra)
    .filter(([, valor]) => Boolean(valor))
    .map(([nome, valor]) => `${nome}=${encodeURIComponent(valor as string)}`);

  /** URL com esta instituicao ligada ou desligada, preservando o resto. */
  function alternar(ids: string[], ativo: boolean): string {
    const restante = ativo
      ? selected.filter((id) => !ids.includes(id))
      : [...selected, ...ids];
    const unicos = [...new Set(restante)];
    const partes = unicos.length ? [...base, `contas=${unicos.map(encodeURIComponent).join(",")}`] : base;
    return partes.length ? `${action}?${partes.join("&")}` : action;
  }

  const todas = selected.length === 0;

  return (
    <div className="contas-linha" role="group" aria-label="Filtrar por instituicao">
      {bancos.map(([banco, contas]) => {
        const ids = contas.map((c) => c.id);
        const ativo = ids.every((id) => selected.includes(id));
        const cor = corDaInstituicao(banco);

        return (
          <Link
            key={banco}
            className={`conta-chip${ativo ? " ativo" : ""}${todas ? " neutro" : ""}`}
            href={alternar(ids, ativo)}
            style={{ "--conta-cor": cor } as React.CSSProperties}
            aria-current={ativo ? "true" : undefined}
          >
            <span className="conta-marca" aria-hidden />
            <span className="conta-nome">{banco}</span>
          </Link>
        );
      })}

      {todas ? null : (
        <Link className="conta-chip limpar" href={base.length ? `${action}?${base.join("&")}` : action}>
          Todas
        </Link>
      )}
    </div>
  );
}
