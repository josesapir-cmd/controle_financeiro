"use client";

import { useState } from "react";

interface Resultado {
  connectorName: string;
  accounts: number;
  transactions: number;
  error?: string;
}

/**
 * Dispara a sincronizacao pela tela.
 *
 * Existe porque cadastrar uma conexao e depois precisar ir ao terminal para ver
 * os dados anula o proposito de haver uma tela de conexoes.
 */
export function SyncButton() {
  const [ocupado, setOcupado] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function sincronizar(dias: number) {
    setOcupado(true);
    setErro(null);
    setResultados(null);

    try {
      const resposta = await fetch(`/api/sync?dias=${dias}`, { method: "POST" });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "falhou");

      setResultados(dados.resultados);
      // Recarrega para os cartoes mostrarem contas e data de sincronizacao.
      setTimeout(() => window.location.reload(), 2500);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel sincronizar");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="sincronizar">
      <div className="filtros">
        <button type="button" onClick={() => sincronizar(45)} disabled={ocupado}>
          {ocupado ? "Sincronizando…" : "Sincronizar (45 dias)"}
        </button>
        <button type="button" className="danger" onClick={() => sincronizar(365)} disabled={ocupado}>
          Carga historica (365 dias)
        </button>
      </div>

      {ocupado ? (
        <p className="account-meta" style={{ marginTop: 8 }}>
          Pode levar alguns minutos. Nao feche esta aba.
        </p>
      ) : null}

      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
        </p>
      ) : null}

      {resultados ? (
        <ul className="resultado-sync">
          {resultados.map((r) => (
            <li key={r.connectorName}>
              <span className="description">{r.connectorName}</span>
              <span className={r.error ? "negative" : "account-meta"}>
                {r.error ?? `${r.accounts} contas · ${r.transactions} lancamentos`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
