import type { AccountOption } from "@/lib/finance/service";

/**
 * Selecao multipla por instituicao.
 *
 * Cada linha e um banco, nao uma conta: quem filtra quer "sem o BTG", nao "sem a
 * conta corrente do BTG". O valor enviado continua sendo a lista de ids de conta
 * daquele banco, separada por virgula — parseAccountIds ja aceita essa forma,
 * entao o filtro do lado do servidor nao precisa saber de instituicoes.
 *
 * Usa <details> com formulario GET: abre como menu, aceita varias marcacoes e
 * envia tudo junto, sem JavaScript no cliente. O estado fica na URL, entao a
 * visao filtrada e compartilhavel e o botao voltar funciona.
 *
 * Nenhuma marcacao significa "todas": e o estado inicial da tela, e um filtro
 * que comeca escondendo tudo seria hostil.
 */
export function AccountFilter({
  options,
  selected,
  action,
  hidden = {},
}: {
  options: AccountOption[];
  selected: string[];
  /** Rota para onde o formulario envia, tipicamente a propria aba. */
  action: string;
  /** Outros parametros da URL que precisam sobreviver ao envio. */
  hidden?: Record<string, string | undefined>;
}) {
  if (options.length === 0) return null;

  const porBanco = new Map<string, AccountOption[]>();
  for (const opcao of options) {
    const lista = porBanco.get(opcao.connectorName) ?? [];
    lista.push(opcao);
    porBanco.set(opcao.connectorName, lista);
  }

  const bancos = [...porBanco.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
  const marcados = bancos.filter(([, contas]) => contas.every((c) => selected.includes(c.id)));

  const resumo =
    selected.length === 0
      ? `Todas as instituicoes (${bancos.length})`
      : `${marcados.length} de ${bancos.length} instituicoes`;

  return (
    <details className="filtro-contas">
      <summary>{resumo}</summary>

      <form className="filtro-contas-menu" method="get" action={action}>
        {Object.entries(hidden).map(([nome, valor]) =>
          valor ? <input key={nome} type="hidden" name={nome} value={valor} /> : null,
        )}

        {bancos.map(([banco, contas]) => (
          <label key={banco}>
            <input
              type="checkbox"
              name="contas"
              value={contas.map((c) => c.id).join(",")}
              defaultChecked={contas.every((c) => selected.includes(c.id))}
            />
            <span>
              {banco}
              <span className="account-meta">
                {" "}
                · {contas.length} {contas.length === 1 ? "conta" : "contas"}
              </span>
            </span>
          </label>
        ))}

        <div className="filtro-contas-acoes">
          <button type="submit">Aplicar</button>
          <a href={action}>Limpar</a>
        </div>
      </form>
    </details>
  );
}
