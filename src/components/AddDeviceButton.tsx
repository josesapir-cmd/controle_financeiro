"use client";

import { useState } from "react";

/**
 * Gera o codigo para registrar outro dispositivo.
 *
 * Existe para que adicionar o celular nao gaste o codigo de recuperacao, que
 * deve ficar guardado offline para a emergencia real.
 */
export function AddDeviceButton() {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    setOcupado(true);
    setErro(null);

    try {
      const resposta = await fetch("/api/auth/dispositivo", { method: "POST" });
      const dados = await resposta.json();
      if (!resposta.ok) throw new Error(dados.error ?? "falhou");
      setCodigo(dados.codigo);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "nao foi possivel gerar o codigo");
    } finally {
      setOcupado(false);
    }
  }

  if (codigo) {
    return (
      <div>
        <p className="empty" style={{ marginTop: 0 }}>
          No outro dispositivo, abra esta mesma URL, toque em{" "}
          <strong>Adicionar este dispositivo</strong> e digite:
        </p>
        <p className="codigo-recuperacao">{codigo}</p>
        <p className="account-meta">Vale por 10 minutos e uma unica vez.</p>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={gerar} disabled={ocupado}>
        {ocupado ? "Gerando…" : "Gerar codigo para outro dispositivo"}
      </button>
      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
