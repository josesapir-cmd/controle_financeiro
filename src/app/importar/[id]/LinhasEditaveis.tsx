import type { ImportacaoLinha } from "@/lib/db/repository";

/**
 * Tabela editavel de linhas lidas, usada pelos tres blocos da conferencia.
 *
 * Os campos carregam o indice da linha no lote, nao a posicao dentro do bloco:
 * os tres blocos vivem no mesmo formulario, e e o indice do lote que a acao de
 * confirmacao conhece.
 */
export interface LinhaComIndice {
  linha: ImportacaoLinha;
  indice: number;
}

export function LinhasEditaveis({
  itens,
  incluirPorPadrao,
  mostrarOrigem = true,
}: {
  itens: LinhaComIndice[];
  /** Repetida entre envios comeca desmarcada; o resto ja vem marcado. */
  incluirPorPadrao: boolean;
  mostrarOrigem?: boolean;
}) {
  return (
    <div className="table-scroll">
      <table className="empilha">
        <thead>
          <tr>
            <th>Incluir</th>
            <th>Data</th>
            <th>Descricao</th>
            {mostrarOrigem ? <th>Origem</th> : null}
            <th>Tipo</th>
            <th className="num">Valor</th>
          </tr>
        </thead>
        <tbody>
          {itens.map(({ linha, indice }) => (
            <tr key={linha.id}>
              <td data-rotulo="Incluir">
                <input
                  type="checkbox"
                  name={`incluir_${indice}`}
                  defaultChecked={incluirPorPadrao}
                  aria-label={`Incluir ${linha.descricao}`}
                />
                <input type="hidden" name={`confianca_${indice}`} value={linha.confianca} />
                <input type="hidden" name={`ocorrencia_${indice}`} value={linha.ocorrencia} />
              </td>
              <td data-rotulo="Data">
                <input
                  type="date"
                  name={`data_${indice}`}
                  defaultValue={linha.dia}
                  aria-label="Data"
                />
              </td>
              <td className="description" data-rotulo="Descricao">
                <input
                  type="text"
                  name={`descricao_${indice}`}
                  defaultValue={linha.descricao}
                  className="largo"
                  aria-label="Descricao"
                />
                {linha.confianca !== "alta" ? (
                  <span className="tag">leitura {linha.confianca}</span>
                ) : null}
              </td>
              {mostrarOrigem ? (
                <td data-rotulo="Origem">
                  <span className="account-meta" title={linha.arquivos.join(", ")}>
                    envio {linha.envio}
                    {linha.arquivos.length ? ` · ${linha.arquivos[0]}` : ""}
                    {linha.arquivos.length > 1 ? ` +${linha.arquivos.length - 1}` : ""}
                  </span>
                </td>
              ) : null}
              <td data-rotulo="Tipo">
                <select
                  name={`tipo_${indice}`}
                  defaultValue={linha.valor > 0 ? "entrada" : "despesa"}
                >
                  <option value="despesa">Despesa</option>
                  <option value="entrada">Entrada</option>
                </select>
              </td>
              <td className="amount" data-rotulo="Valor">
                <input
                  type="text"
                  inputMode="decimal"
                  name={`valor_${indice}`}
                  defaultValue={Math.abs(linha.valor).toFixed(2)}
                  className="numerico"
                  aria-label="Valor"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
