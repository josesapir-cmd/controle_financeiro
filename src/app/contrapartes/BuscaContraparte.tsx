"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

/**
 * Busca de contraparte por nome.
 *
 * Navega em vez de filtrar no cliente: a lista da tela cobre so o periodo
 * escolhido, e procurar alguem quase sempre e procurar fora dele — a busca vai
 * ao servidor porque e la que esta o historico inteiro.
 *
 * O termo entra na URL, entao um resultado e compartilhavel e o voltar do
 * navegador funciona.
 */
export function BuscaContraparte({
  termo,
  rotaBase,
}: {
  termo: string;
  /** A pagina com o periodo e as contas ja na query. */
  rotaBase: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(termo);
  const [pendente, iniciar] = useTransition();
  const campo = useRef<HTMLInputElement>(null);

  // O termo pode mudar por fora — voltar do navegador, ou limpar pelo botao.
  useEffect(() => setTexto(termo), [termo]);

  function buscar(valor: string) {
    const limpo = valor.trim();
    iniciar(() => {
      router.push(limpo ? `${rotaBase}&busca=${encodeURIComponent(limpo)}` : rotaBase);
    });
  }

  return (
    <form
      className="busca"
      role="search"
      onSubmit={(evento) => {
        evento.preventDefault();
        buscar(texto);
      }}
    >
      <label className="busca-campo">
        <span className="cp-oculto">Buscar contraparte</span>
        <input
          ref={campo}
          type="search"
          value={texto}
          placeholder="Buscar contraparte pelo nome"
          onChange={(evento) => setTexto(evento.target.value)}
          onKeyDown={(evento) => {
            // Esc limpa e volta para a lista, sem tirar a mao do teclado.
            if (evento.key === "Escape" && texto) {
              evento.preventDefault();
              setTexto("");
              buscar("");
            }
          }}
        />
      </label>

      <button type="submit" disabled={pendente || !texto.trim()}>
        {pendente ? "Buscando…" : "Buscar"}
      </button>

      {termo ? (
        <button
          type="button"
          className="cp-remover"
          onClick={() => {
            setTexto("");
            buscar("");
            campo.current?.focus();
          }}
        >
          limpar
        </button>
      ) : null}
    </form>
  );
}
