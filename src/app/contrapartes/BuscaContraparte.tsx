"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import {
  MINIMO_DO_AUTOCOMPLETE,
  type SugestaoDeContraparte,
} from "@/lib/finance/busca-de-contraparte";
import { sugerirContrapartes } from "./actions";

/** Espera antes de ir ao servidor. Uma digitada continua valendo uma consulta. */
const ESPERA_MS = 180;

/**
 * Busca de contraparte por nome, com autocomplete.
 *
 * Navega em vez de filtrar no cliente: a lista da tela cobre so o periodo
 * escolhido, e procurar alguem quase sempre e procurar fora dele — a busca vai
 * ao servidor porque e la que esta o historico inteiro.
 *
 * O termo entra na URL, entao um resultado e compartilhavel e o voltar do
 * navegador funciona. Escolher uma sugestao ja abre o historico daquela
 * contraparte, porque quem clicou num nome nao queria uma lista de um item.
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
  const [sugestoes, setSugestoes] = useState<SugestaoDeContraparte[]>([]);
  const [aberto, setAberto] = useState(false);
  const [destacada, setDestacada] = useState(-1);
  const campo = useRef<HTMLInputElement>(null);
  const listaId = useId();
  /*
   * O texto que acabou de ser escolhido ou submetido.
   *
   * Sem isto a lista voltaria sozinha depois de escolher: a navegacao nao e
   * instantanea, entao por uns instantes `texto` ja e o nome clicado enquanto
   * `termo` ainda e o antigo — o efeito nao ve termo igual, busca de novo e
   * reabre a lista em cima do historico que a pessoa pediu.
   */
  const jaResolvido = useRef<string | null>(null);

  // O termo pode mudar por fora — voltar do navegador, ou limpar pelo botao.
  useEffect(() => setTexto(termo), [termo]);

  /*
   * Busca de sugestoes com debounce.
   *
   * O `cancelado` nao e so higiene de efeito: sem ele, uma resposta lenta de
   * "mer" chegando depois da de "mercado" repintaria a lista com o resultado do
   * termo antigo, e a pessoa veria sugestoes que nao correspondem ao que esta
   * escrito no campo.
   */
  useEffect(() => {
    const procurado = texto.trim();
    if (procurado.length < MINIMO_DO_AUTOCOMPLETE) {
      setSugestoes([]);
      setAberto(false);
      return;
    }

    // Nao reabre a lista com o termo que a tela ja esta respondendo.
    if (procurado === termo.trim() || procurado === jaResolvido.current) return;

    let cancelado = false;
    const relogio = setTimeout(async () => {
      try {
        const achadas = await sugerirContrapartes(procurado);
        if (cancelado) return;
        setSugestoes(achadas);
        setAberto(achadas.length > 0);
        setDestacada(-1);
      } catch {
        // Autocomplete e conveniencia: se falhar, o botao Buscar continua indo
        // ao servidor pelo caminho normal. Nao vale um alerta na tela.
        if (!cancelado) setAberto(false);
      }
    }, ESPERA_MS);

    return () => {
      cancelado = true;
      clearTimeout(relogio);
    };
  }, [texto, termo]);

  function buscar(valor: string) {
    const limpo = valor.trim();
    jaResolvido.current = limpo;
    setSugestoes([]);
    setAberto(false);
    iniciar(() => {
      router.push(limpo ? `${rotaBase}&busca=${encodeURIComponent(limpo)}` : rotaBase);
    });
  }

  /** Abre direto o historico da contraparte escolhida. */
  function escolher(sugestao: SugestaoDeContraparte) {
    jaResolvido.current = sugestao.nome.trim();
    setTexto(sugestao.nome);
    setSugestoes([]);
    setAberto(false);
    setDestacada(-1);
    iniciar(() => {
      router.push(
        `${rotaBase}&busca=${encodeURIComponent(sugestao.nome)}&ver=${encodeURIComponent(
          sugestao.key,
        )}`,
      );
    });
  }

  function aoTeclar(evento: React.KeyboardEvent<HTMLInputElement>) {
    if (evento.key === "Escape") {
      // Primeiro Esc fecha a lista; o seguinte limpa a busca. Fechar e desfazer
      // sao coisas diferentes e a mesma tecla nao deve fazer as duas de uma vez.
      if (aberto) {
        evento.preventDefault();
        setAberto(false);
        return;
      }
      if (texto) {
        evento.preventDefault();
        setTexto("");
        buscar("");
      }
      return;
    }

    if (!aberto || sugestoes.length === 0) return;

    if (evento.key === "ArrowDown") {
      evento.preventDefault();
      setDestacada((i) => (i + 1) % sugestoes.length);
    } else if (evento.key === "ArrowUp") {
      evento.preventDefault();
      setDestacada((i) => (i <= 0 ? sugestoes.length - 1 : i - 1));
    } else if (evento.key === "Enter" && destacada >= 0) {
      evento.preventDefault();
      escolher(sugestoes[destacada]);
    }
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
          type="text"
          value={texto}
          placeholder="Buscar contraparte pelo nome"
          role="combobox"
          aria-expanded={aberto}
          aria-controls={listaId}
          aria-autocomplete="list"
          aria-activedescendant={
            aberto && destacada >= 0 ? `${listaId}-${destacada}` : undefined
          }
          autoComplete="off"
          onChange={(evento) => {
            // Digitar de novo desfaz a trava: a partir daqui o termo e outro.
            jaResolvido.current = null;
            setTexto(evento.target.value);
          }}
          onKeyDown={aoTeclar}
          // Fecha no blur com atraso: sem ele, o blur do campo apaga a lista
          // antes de o clique na sugestao chegar, e clicar nunca funcionaria.
          onBlur={() => setTimeout(() => setAberto(false), 120)}
          onFocus={() => setAberto(sugestoes.length > 0)}
        />

        {aberto && sugestoes.length > 0 ? (
          <ul className="busca-sugestoes" id={listaId} role="listbox">
            {sugestoes.map((sugestao, i) => (
              <li
                key={sugestao.key}
                id={`${listaId}-${i}`}
                role="option"
                aria-selected={i === destacada}
                className={i === destacada ? "destacada" : undefined}
                onMouseEnter={() => setDestacada(i)}
                // mousedown, e nao click: o click chega depois do blur.
                onMouseDown={(evento) => {
                  evento.preventDefault();
                  escolher(sugestao);
                }}
              >
                <span className="description">{sugestao.apelido ?? sugestao.nome}</span>
                {sugestao.apelido && sugestao.apelido !== sugestao.nome ? (
                  <span className="account-meta">{sugestao.nome}</span>
                ) : null}
                <span className="account-meta sugestao-contagem">
                  {sugestao.contagem}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
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
