"use client";

import { useState } from "react";
import { gerarConviteDaAssistente } from "./actions";

/**
 * Gera o convite da assistente e o mostra uma vez.
 *
 * O codigo nao fica guardado em lugar nenhum legivel — so o hash —, entao
 * sair desta tela sem copiar e gerar outro. Gerar outro invalida o anterior.
 */
export function ConviteAssistente({ temConvite }: { temConvite: boolean }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [horas, setHoras] = useState(48);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function gerar() {
    setOcupado(true);
    setErro(null);
    try {
      const resposta = await gerarConviteDaAssistente();
      if ("erro" in resposta) {
        setErro(resposta.erro);
        return;
      }
      setCodigo(resposta.codigo);
      setHoras(resposta.horas);
    } catch {
      setErro("nao foi possivel gerar o convite");
    } finally {
      setOcupado(false);
    }
  }

  if (codigo) {
    return (
      <div>
        <p className="empty" style={{ marginTop: 0 }}>
          Mande para a assistente o endereco do app e este codigo. Na tela de entrada ela toca em{" "}
          <strong>Recebi um convite</strong>, digita o codigo e cria a passkey dela.
        </p>
        <p className="codigo-recuperacao">{codigo}</p>
        <p className="account-meta">
          Vale por {horas} horas e uma unica vez. Gerar outro invalida este.
        </p>
      </div>
    );
  }

  return (
    <div>
      <button type="button" onClick={gerar} disabled={ocupado}>
        {ocupado ? "Gerando…" : temConvite ? "Gerar outro convite" : "Gerar convite"}
      </button>
      {erro ? (
        <p className="form-message negative" role="alert">
          {erro}
        </p>
      ) : null}
    </div>
  );
}
