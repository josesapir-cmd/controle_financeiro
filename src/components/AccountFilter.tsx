import type { AccountOption } from "@/lib/finance/service";

/**
 * Selecao multipla de contas, valida em todas as abas.
 *
 * Usa <details> com um formulario GET dentro: abre como um menu, aceita varias
 * marcacoes de uma vez e envia tudo junto. Sem JavaScript no cliente — o estado
 * fica na URL, entao a visao filtrada e compartilhavel e o botao voltar
 * funciona como o usuario espera.
 *
 * Nenhuma conta marcada significa "todas": e o estado inicial da tela, e um
 * filtro que comeca escondendo tudo seria hostil.
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

  const resumo =
    selected.length === 0
      ? `Todas as contas (${options.length})`
      : `${selected.length} de ${options.length} contas`;

  return (
    <details className="filtro-contas">
      <summary>{resumo}</summary>

      <form className="filtro-contas-menu" method="get" action={action}>
        {Object.entries(hidden).map(([nome, valor]) =>
          valor ? <input key={nome} type="hidden" name={nome} value={valor} /> : null,
        )}

        {[...porBanco.entries()].map(([banco, contas]) => (
          <fieldset key={banco}>
            <legend>{banco}</legend>
            {contas.map((conta) => (
              <label key={conta.id}>
                <input
                  type="checkbox"
                  name="contas"
                  value={conta.id}
                  defaultChecked={selected.includes(conta.id)}
                />
                {conta.label}
              </label>
            ))}
          </fieldset>
        ))}

        <div className="filtro-contas-acoes">
          <button type="submit">Aplicar</button>
          <a href={action}>Limpar</a>
        </div>
      </form>
    </details>
  );
}
