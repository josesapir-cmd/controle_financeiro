"use client";

import { useActionState } from "react";
import { adicionarConexao, type FormState } from "./actions";

const inicial: FormState = {};

export function ConnectionForm() {
  const [estado, acao, pendente] = useActionState(adicionarConexao, inicial);

  return (
    <form action={acao} className="connection-form">
      <input
        type="text"
        name="itemId"
        placeholder="https://meu.pluggy.ai/connections/..."
        aria-label="URL da conexao no Meu Pluggy ou itemId"
        autoComplete="off"
      />
      <button type="submit" disabled={pendente}>
        {pendente ? "Adicionando..." : "Adicionar"}
      </button>
      {estado.erro ? (
        <p className="form-message negative" role="alert">
          {estado.erro}
        </p>
      ) : null}
      {estado.sucesso ? (
        <p className="form-message positive" role="status">
          {estado.sucesso}
        </p>
      ) : null}
    </form>
  );
}
